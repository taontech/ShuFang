import type Database from "better-sqlite3";
import { XMLParser } from "fast-xml-parser";
import JSZip from "jszip";
import { parseFile } from "music-metadata";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";

const bookExtensions = new Set([".epub"]);
const audioExtensions = new Set([".mp3", ".m4a", ".aac", ".flac", ".alac", ".wav", ".ogg", ".opus"]);
const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text"
});

export type ScanResult = {
  roots: number;
  files: number;
  books: number;
  audio: number;
  skipped: number;
  errors: Array<{ file: string; message: string }>;
};

export async function scanLibrary(db: Database.Database): Promise<ScanResult> {
  const roots = db
    .prepare("SELECT id, path FROM scan_roots WHERE enabled = 1 ORDER BY created_at")
    .all() as Array<{ id: string; path: string }>;
  const result: ScanResult = { roots: roots.length, files: 0, books: 0, audio: 0, skipped: 0, errors: [] };

  for (const root of roots) {
    const rootPath = resolve(root.path);
    try {
      for await (const filePath of walk(rootPath)) {
        result.files += 1;
        const extension = extname(filePath).toLowerCase();
        try {
          if (bookExtensions.has(extension)) {
            await upsertBook(db, filePath);
            result.books += 1;
          } else if (audioExtensions.has(extension)) {
            await upsertAudio(db, filePath);
            result.audio += 1;
          } else {
            result.skipped += 1;
          }
        } catch (error) {
          result.errors.push({ file: filePath, message: error instanceof Error ? error.message : String(error) });
        }
      }
      db.prepare("UPDATE scan_roots SET last_scanned_at = CURRENT_TIMESTAMP WHERE id = ?").run(root.id);
    } catch (error) {
      result.errors.push({ file: rootPath, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

export async function addScanRoot(db: Database.Database, path: string) {
  const rootPath = resolve(path.trim());
  const rootStat = await stat(rootPath);
  if (!rootStat.isDirectory()) {
    throw new Error("资源路径必须是目录");
  }

  const existing = db.prepare("SELECT id, path, enabled, last_scanned_at AS lastScannedAt FROM scan_roots WHERE path = ?").get(rootPath);
  if (existing) return existing;

  const id = stableId(rootPath);
  db.prepare("INSERT INTO scan_roots (id, path) VALUES (?, ?)").run(id, rootPath);
  return { id, path: rootPath, enabled: 1, lastScannedAt: null };
}

async function* walk(rootPath: string): AsyncGenerator<string> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const entryPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      yield* walk(entryPath);
    } else if (entry.isFile()) {
      yield entryPath;
    }
  }
}

async function upsertBook(db: Database.Database, filePath: string) {
  const metadata = await readEpubMetadata(filePath);
  db.prepare(`
    INSERT INTO books (id, file_path, title, author, cover_path, description, language, updated_at)
    VALUES (@id, @filePath, @title, @author, @coverPath, @description, @language, CURRENT_TIMESTAMP)
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title,
      author = excluded.author,
      cover_path = excluded.cover_path,
      description = excluded.description,
      language = excluded.language,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    id: stableId(filePath),
    filePath,
    title: metadata.title,
    author: metadata.author,
    coverPath: metadata.coverPath,
    description: metadata.description,
    language: metadata.language
  });
}

async function upsertAudio(db: Database.Database, filePath: string) {
  const metadata = await parseFile(filePath, { duration: true });
  const common = metadata.common;
  const coverPath = common.picture?.[0]
    ? await writeCoverAsset(filePath, common.picture[0].data, mimeExtension(common.picture[0].format))
    : await findFolderCover(filePath);
  const kind = /podcast|播客|有声|audiobook/i.test(`${common.genre?.join(" ")} ${dirname(filePath)}`) ? "podcast" : "music";

  db.prepare(`
    INSERT INTO audio_tracks (id, file_path, title, artist, album, duration, cover_path, kind, updated_at)
    VALUES (@id, @filePath, @title, @artist, @album, @duration, @coverPath, @kind, CURRENT_TIMESTAMP)
    ON CONFLICT(file_path) DO UPDATE SET
      title = excluded.title,
      artist = excluded.artist,
      album = excluded.album,
      duration = excluded.duration,
      cover_path = excluded.cover_path,
      kind = excluded.kind,
      updated_at = CURRENT_TIMESTAMP
  `).run({
    id: stableId(filePath),
    filePath,
    title: common.title ?? basename(filePath, extname(filePath)),
    artist: common.artist ?? common.albumartist ?? null,
    album: common.album ?? null,
    duration: metadata.format.duration ?? null,
    coverPath,
    kind
  });
}

async function readEpubMetadata(filePath: string) {
  const zip = await JSZip.loadAsync(await readFile(filePath));
  const containerFile = zip.file("META-INF/container.xml");
  if (!containerFile) {
    throw new Error("EPUB 缺少 container.xml");
  }

  const container = parser.parse(await containerFile.async("text"));
  const rootfile = first(container?.container?.rootfiles?.rootfile);
  const opfPath = rootfile?.["@_full-path"];
  if (!opfPath || !zip.file(opfPath)) {
    throw new Error("EPUB 缺少 OPF 元数据");
  }

  const opf = parser.parse(await zip.file(opfPath)!.async("text"));
  const metadata = opf?.package?.metadata ?? {};
  const manifest = arrayOf(opf?.package?.manifest?.item);
  const title = textValue(first(metadata["dc:title"])) ?? basename(filePath, extname(filePath));
  const author = textValue(first(metadata["dc:creator"]));
  const language = textValue(first(metadata["dc:language"]));
  const description = textValue(first(metadata["dc:description"]));
  const coverHref = findCoverHref(metadata, manifest);
  const coverPath = coverHref ? await extractEpubCover(zip, opfPath, coverHref, filePath) : null;

  return { title, author, language, description, coverPath };
}

function findCoverHref(metadata: Record<string, unknown>, manifest: Array<Record<string, string>>) {
  const coverMeta = arrayOf(metadata.meta as Record<string, string> | Record<string, string>[] | undefined).find(
    (item) => item?.["@_name"] === "cover"
  );
  const coverId = coverMeta?.["@_content"];
  const byMeta = coverId ? manifest.find((item) => item["@_id"] === coverId) : undefined;
  const byProperties = manifest.find((item) => item["@_properties"]?.includes("cover-image"));
  return byMeta?.["@_href"] ?? byProperties?.["@_href"] ?? null;
}

async function extractEpubCover(zip: JSZip, opfPath: string, coverHref: string, filePath: string) {
  const coverZipPath = join(dirname(opfPath), coverHref).replaceAll("\\", "/");
  const file = zip.file(coverZipPath) ?? zip.file(coverHref);
  if (!file) return null;

  const extension = extname(coverHref) || ".jpg";
  return writeCoverAsset(filePath, await file.async("nodebuffer"), extension);
}

async function writeCoverAsset(sourcePath: string, data: Buffer | Uint8Array, extension: string) {
  const dir = join(process.cwd(), "data", "covers");
  await mkdir(dir, { recursive: true });
  const fileName = `${stableId(sourcePath)}${extension}`;
  const assetPath = join(dir, fileName);
  await writeFile(assetPath, data);
  return `/assets/covers/${fileName}`;
}

async function findFolderCover(filePath: string) {
  const names = ["cover.jpg", "cover.png", "folder.jpg", "folder.png", "front.jpg", "front.png"];
  for (const name of names) {
    const coverPath = join(dirname(filePath), name);
    try {
      await stat(coverPath);
      return writeCoverAsset(coverPath, await readFile(coverPath), extname(coverPath));
    } catch {
      // Keep looking for common local cover filenames.
    }
  }
  return null;
}

function stableId(value: string) {
  return createHash("sha1").update(resolve(value)).digest("hex");
}

function mimeExtension(mime: string) {
  if (mime.includes("png")) return ".png";
  if (mime.includes("webp")) return ".webp";
  return ".jpg";
}

function first<T>(value: T | T[] | undefined): T | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function arrayOf<T>(value: T | T[] | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim();
  if (typeof value === "object" && "#text" in value) {
    const text = (value as { "#text"?: string })["#text"];
    return text?.trim() || null;
  }
  return null;
}
