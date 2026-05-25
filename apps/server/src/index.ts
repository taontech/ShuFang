import Fastify from "fastify";
import fastifyStatic from "@fastify/static";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { extname, join } from "node:path";
import { openDatabase } from "./database.js";
import { addScanRoot, scanLibrary } from "./scanner.js";

const port = Number(process.env.PORT ?? 4141);
const host = process.env.HOST ?? "0.0.0.0";
const db = openDatabase();

const app = Fastify({
  logger: {
    level: process.env.LOG_LEVEL ?? "info"
  }
});

app.addHook("onRequest", (request, reply, done) => {
  reply.header("Access-Control-Allow-Origin", "*");
  reply.header("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
  reply.header("Access-Control-Allow-Headers", "Content-Type");
  if (request.method === "OPTIONS") {
    reply.code(204).send();
    return;
  }
  done();
});

await app.register(fastifyStatic, {
  root: join(process.cwd(), "data", "covers"),
  prefix: "/assets/covers/",
  decorateReply: false
});

app.get("/api/health", async () => ({
  ok: true,
  name: "shufang",
  service: "local-service"
}));

app.get("/api/library/summary", async () => ({
  users: count("users"),
  books: count("books"),
  tracks: count("audio_tracks", "kind = 'music'"),
  podcasts: count("audio_tracks", "kind = 'podcast'")
}));

app.get("/api/users", async () => {
  return db.prepare("SELECT id, name, avatar, role FROM users ORDER BY created_at").all();
});

app.get<{ Querystring: { userId?: string } }>("/api/books", async (request) => {
  const userId = request.query.userId ?? "u-1";
  return db
    .prepare(
      `
      SELECT
        b.id,
        b.title,
        b.author,
        b.cover_path AS coverPath,
        b.description,
        COALESCE(p.percentage, 0) AS progress,
        p.cfi,
        p.chapter_title AS chapterTitle
      FROM books b
      LEFT JOIN book_progress p ON p.book_id = b.id AND p.user_id = ?
      ORDER BY b.updated_at DESC
    `
    )
    .all(userId);
});

app.get<{ Params: { bookId: string } }>("/api/books/:bookId/file", async (request, reply) => {
  const book = db.prepare("SELECT file_path AS filePath FROM books WHERE id = ?").get(request.params.bookId) as
    | { filePath: string }
    | undefined;
  if (!book) return reply.code(404).send({ error: "book_not_found" });
  await ensureFile(book.filePath);
  reply.header("Content-Type", "application/epub+zip");
  reply.header("Content-Disposition", `attachment; filename="${encodeURIComponent(book.filePath.split("/").pop() ?? "book.epub")}"`);
  reply.header("Cache-Control", "public, max-age=31536000, immutable");
  reply.header("Accept-Ranges", "bytes");
  return reply.send(createReadStream(book.filePath));
});

app.put<{
  Params: { bookId: string };
  Body: { userId: string; cfi: string; percentage: number; chapterTitle?: string };
}>("/api/books/:bookId/progress", async (request) => {
  const { bookId } = request.params;
  const { userId, cfi, percentage, chapterTitle } = request.body;

  db.prepare(`
    INSERT INTO book_progress (user_id, book_id, cfi, percentage, chapter_title, updated_at)
    VALUES (@userId, @bookId, @cfi, @percentage, @chapterTitle, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, book_id) DO UPDATE SET
      cfi = excluded.cfi,
      percentage = excluded.percentage,
      chapter_title = excluded.chapter_title,
      updated_at = CURRENT_TIMESTAMP
  `).run({ userId, bookId, cfi, percentage, chapterTitle: chapterTitle ?? null });

  return { ok: true };
});

app.get<{ Querystring: { userId?: string; bookId?: string } }>("/api/bookmarks", async (request) => {
  const userId = request.query.userId ?? "u-1";
  const bookId = request.query.bookId;
  if (bookId) {
    return db
      .prepare(
        "SELECT id, book_id AS bookId, cfi, title, note, color, created_at AS createdAt FROM bookmarks WHERE user_id = ? AND book_id = ? ORDER BY created_at DESC"
      )
      .all(userId, bookId);
  }
  return db
    .prepare(
      "SELECT id, book_id AS bookId, cfi, title, note, color, created_at AS createdAt FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC"
    )
    .all(userId);
});

app.post<{
  Body: { userId: string; bookId: string; cfi: string; title?: string; note?: string; color?: string };
}>("/api/bookmarks", async (request) => {
  const id = randomUUID();
  const { userId, bookId, cfi, title, note, color } = request.body;
  db.prepare(
    "INSERT INTO bookmarks (id, user_id, book_id, cfi, title, note, color) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).run(id, userId, bookId, cfi, title ?? null, note ?? null, color ?? null);
  return { id, userId, bookId, cfi, title: title ?? null, note: note ?? null, color: color ?? null };
});

app.delete<{ Params: { bookmarkId: string } }>("/api/bookmarks/:bookmarkId", async (request) => {
  db.prepare("DELETE FROM bookmarks WHERE id = ?").run(request.params.bookmarkId);
  return { ok: true };
});

app.get<{ Querystring: { kind?: "music" | "podcast" } }>("/api/audio", async (request) => {
  const kind = request.query.kind ?? "music";
  return db
    .prepare(
      `
      SELECT id, title, artist, album, duration, cover_path AS coverPath, kind
      FROM audio_tracks
      WHERE kind = ?
      ORDER BY album, title
    `
    )
    .all(kind);
});

app.get<{ Params: { trackId: string } }>("/api/audio/:trackId/stream", async (request, reply) => {
  const track = db.prepare("SELECT file_path AS filePath FROM audio_tracks WHERE id = ?").get(request.params.trackId) as
    | { filePath: string }
    | undefined;
  if (!track) return reply.code(404).send({ error: "track_not_found" });
  await ensureFile(track.filePath);
  reply.header("Content-Type", audioContentType(track.filePath));
  return reply.send(createReadStream(track.filePath));
});

app.get<{ Params: { trackId: string } }>("/api/audio/:trackId/lyrics", async (request, reply) => {
  const track = db.prepare("SELECT file_path AS filePath FROM audio_tracks WHERE id = ?").get(request.params.trackId) as
    | { filePath: string }
    | undefined;
  if (!track) return reply.code(404).send({ error: "track_not_found" });

  const basePath = track.filePath.slice(0, -extname(track.filePath).length);
  for (const extension of [".lrc", ".txt"]) {
    try {
      const text = await readFile(`${basePath}${extension}`, "utf-8");
      return { kind: extension === ".lrc" ? "lrc" : "plain", lines: parseLyrics(text) };
    } catch {
      // Try the next local lyric sidecar file.
    }
  }
  return { kind: "none", lines: [] };
});

app.get("/api/roots", async () => {
  return db
    .prepare("SELECT id, path, enabled, last_scanned_at AS lastScannedAt, created_at AS createdAt FROM scan_roots ORDER BY created_at DESC")
    .all();
});

app.post<{ Body: { path: string } }>("/api/roots", async (request, reply) => {
  try {
    return await addScanRoot(db, request.body.path);
  } catch (error) {
    return reply.code(400).send({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete<{ Params: { rootId: string } }>("/api/roots/:rootId", async (request) => {
  db.prepare("DELETE FROM scan_roots WHERE id = ?").run(request.params.rootId);
  return { ok: true };
});

app.post("/api/scan", async () => {
  return scanLibrary(db);
});

await app.listen({ port, host });

function count(table: string, where?: string) {
  const sql = where ? `SELECT COUNT(*) AS count FROM ${table} WHERE ${where}` : `SELECT COUNT(*) AS count FROM ${table}`;
  return (db.prepare(sql).get() as { count: number }).count;
}

async function ensureFile(filePath: string) {
  const fileStat = await stat(filePath);
  if (!fileStat.isFile()) throw new Error("Not a file");
}

function audioContentType(filePath: string) {
  if (filePath.endsWith(".flac")) return "audio/flac";
  if (filePath.endsWith(".wav")) return "audio/wav";
  if (filePath.endsWith(".ogg") || filePath.endsWith(".opus")) return "audio/ogg";
  if (filePath.endsWith(".m4a") || filePath.endsWith(".aac") || filePath.endsWith(".alac")) return "audio/mp4";
  return "audio/mpeg";
}

function parseLyrics(text: string) {
  return text
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\[(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?\]\s*(.*)$/);
      if (!match) return { time: null, text: line.trim() };
      const minutes = Number(match[1]);
      const seconds = Number(match[2]);
      const fraction = Number((match[3] ?? "0").padEnd(3, "0"));
      return { time: minutes * 60 + seconds + fraction / 1000, text: match[4].trim() };
    })
    .filter((line) => line.text.length > 0);
}
