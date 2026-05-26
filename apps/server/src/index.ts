import Fastify, { type FastifyReply } from "fastify";
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
        b.file_type AS format,
        b.created_at AS createdAt,
        b.updated_at AS updatedAt,
        COALESCE(p.percentage, 0) AS progress,
        p.cfi,
        p.chapter_title AS chapterTitle,
        p.updated_at AS recentReadAt,
        COALESCE(bm.bookmark_count, 0) AS bookmarkCount
      FROM books b
      LEFT JOIN book_progress p ON p.book_id = b.id AND p.user_id = ?
      LEFT JOIN (
        SELECT book_id, COUNT(*) AS bookmark_count
        FROM bookmarks
        WHERE user_id = ?
        GROUP BY book_id
      ) bm ON bm.book_id = b.id
      ORDER BY COALESCE(p.updated_at, b.updated_at) DESC, b.updated_at DESC
    `
    )
    .all(userId, userId);
});

app.get<{ Params: { bookId: string } }>("/api/books/:bookId/file", async (request, reply) => {
  const book = db.prepare("SELECT file_path AS filePath FROM books WHERE id = ?").get(request.params.bookId) as
    | { filePath: string }
    | undefined;
  if (!book) return reply.code(404).send({ error: "book_not_found" });
  reply.header("Content-Type", bookContentType(book.filePath));
  reply.header("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(book.filePath.split("/").pop() ?? "book.epub")}`);
  reply.header("Cache-Control", "public, max-age=31536000, immutable");
  return streamFileWithRange(book.filePath, request.headers.range, reply);
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

app.get<{ Querystring: { userId?: string; days?: string } }>("/api/reading/activity", async (request) => {
  const userId = request.query.userId ?? "u-1";
  const requestedDays = Number(request.query.days ?? 180);
  const days = Number.isFinite(requestedDays) ? Math.max(Math.floor(requestedDays), 1) : 180;
  return db
    .prepare(
      `
      SELECT day, seconds
      FROM reading_activity
      WHERE user_id = ?
        AND day >= date('now', ?)
      ORDER BY day ASC
    `
    )
    .all(userId, `-${days - 1} days`);
});

app.post<{
  Body: { userId: string; seconds: number; day?: string };
}>("/api/reading/activity", async (request) => {
  const seconds = Math.max(0, Math.min(Math.round(request.body.seconds || 0), 3600));
  if (seconds === 0) return { ok: true };
  const day = request.body.day ?? new Date().toISOString().slice(0, 10);
  db.prepare(`
    INSERT INTO reading_activity (user_id, day, seconds, updated_at)
    VALUES (@userId, @day, @seconds, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, day) DO UPDATE SET
      seconds = seconds + excluded.seconds,
      updated_at = CURRENT_TIMESTAMP
  `).run({ userId: request.body.userId, day, seconds });
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
  reply.header("Content-Type", audioContentType(track.filePath));
  reply.header("Cache-Control", "public, max-age=31536000, immutable");
  return streamFileWithRange(track.filePath, request.headers.range, reply);
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
  return fileStat;
}

async function streamFileWithRange(filePath: string, rangeHeader: string | undefined, reply: FastifyReply) {
  const fileStat = await ensureFile(filePath);
  reply.header("Accept-Ranges", "bytes");
  const range = parseRangeHeader(rangeHeader, fileStat.size);
  if (range) {
    reply.code(206);
    reply.header("Content-Range", `bytes ${range.start}-${range.end}/${fileStat.size}`);
    reply.header("Content-Length", String(range.end - range.start + 1));
    return reply.send(createReadStream(filePath, range));
  }
  reply.header("Content-Length", String(fileStat.size));
  return reply.send(createReadStream(filePath));
}

function parseRangeHeader(rangeHeader: string | undefined, fileSize: number) {
  if (!rangeHeader) return null;
  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;

  let start = match[1] ? Number(match[1]) : 0;
  let end = match[2] ? Number(match[2]) : fileSize - 1;
  if (!match[1] && match[2]) {
    const suffixLength = Number(match[2]);
    start = Math.max(fileSize - suffixLength, 0);
    end = fileSize - 1;
  }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= fileSize) {
    return null;
  }
  return { start, end: Math.min(end, fileSize - 1) };
}

function audioContentType(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".flac") return "audio/flac";
  if (extension === ".wav") return "audio/wav";
  if (extension === ".ogg" || extension === ".opus") return "audio/ogg";
  if (extension === ".m4a" || extension === ".aac" || extension === ".alac") return "audio/mp4";
  return "audio/mpeg";
}

function bookContentType(filePath: string) {
  return extname(filePath).toLowerCase() === ".pdf" ? "application/pdf" : "application/epub+zip";
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
