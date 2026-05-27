// @ts-nocheck
import Fastify, { type FastifyReply } from "fastify";
import fastifyStatic from "@fastify/static";
import fastifyWebsocket from "@fastify/websocket";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
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

interface PlaybackSession {
  trackId: string;
  position: number;
  isPlaying: boolean;
  playMode: string;
  updatedAt: number;
  track?: any;
}

let activeSession: PlaybackSession | null = null;
const connectedSockets = new Set<any>();

// Load active session from database
try {
  const row = db.prepare(
    "SELECT track_id, position, updated_at FROM audio_progress WHERE user_id = 'system' ORDER BY updated_at DESC LIMIT 1"
  ).get() as { track_id: string; position: number; updated_at: string } | undefined;
  if (row) {
    activeSession = {
      trackId: row.track_id,
      position: row.position,
      isPlaying: false,
      playMode: "repeat-all",
      updatedAt: new Date(row.updated_at).getTime() || Date.now()
    };
  }
} catch (e) {
  app.log.error("Failed to load active session from DB on startup: " + e);
}

function saveSessionToDb() {
  if (!activeSession) return;
  try {
    db.prepare(`
      INSERT INTO audio_progress (user_id, track_id, position, updated_at)
      VALUES ('system', @trackId, @position, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, track_id) DO UPDATE SET
        position = excluded.position,
        updated_at = CURRENT_TIMESTAMP
    `).run({
      trackId: activeSession.trackId,
      position: activeSession.position
    });
  } catch (err) {
    app.log.error("Failed to save session to DB: " + err);
  }
}

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

await app.register(fastifyWebsocket as any);

app.get("/api/health", async () => ({
  ok: true,
  name: "shufang",
  service: "local-service"
}));

app.get("/ws/sync", { websocket: true } as any, (connection: any, req: any) => {
  connectedSockets.add(connection.socket);

  if (activeSession) {
    let currentPosition = activeSession.position;
    if (activeSession.isPlaying) {
      const elapsed = (Date.now() - activeSession.updatedAt) / 1000;
      currentPosition += elapsed;
    }
    connection.socket.send(
      JSON.stringify({
        type: "SESSION_STATE",
        trackId: activeSession.trackId,
        position: currentPosition,
        isPlaying: activeSession.isPlaying,
        playMode: activeSession.playMode || "repeat-all",
        hasOtherClients: connectedSockets.size > 1,
        track: activeSession.track
      })
    );
  }

  connection.socket.on("message", (rawMessage) => {
    try {
      const data = JSON.parse(rawMessage.toString());
      const { type, clientId, trackId, position, isPlaying, playMode } = data;

      if (trackId !== undefined) {
        activeSession = {
          trackId,
          position: position ?? 0,
          isPlaying: !!isPlaying,
          playMode: playMode ?? activeSession?.playMode ?? "repeat-all",
          updatedAt: Date.now(),
          track: data.track
        };
      } else if (playMode !== undefined && activeSession) {
        activeSession.playMode = playMode;
        activeSession.updatedAt = Date.now();
      }

      for (const socket of connectedSockets) {
        if (socket !== connection.socket) {
          socket.send(rawMessage.toString());
        }
      }

      if (type === "PAUSE" || !isPlaying) {
        saveSessionToDb();
      }
    } catch (err) {
      app.log.error(err);
    }
  });

  connection.socket.on("close", () => {
    connectedSockets.delete(connection.socket);
    if (connectedSockets.size === 0) {
      saveSessionToDb();
    }
  });
});

app.get("/api/library/summary", async () => ({
  users: count("users"),
  books: count("books"),
  tracks: count("audio_tracks", "kind = 'music'"),
  podcasts: count("audio_tracks", "kind = 'podcast'")
}));

app.get("/api/users", async () => {
  return db.prepare("SELECT id, name, avatar, role FROM users WHERE enabled = 1 ORDER BY created_at").all();
});

app.post<{
  Body: { name: string; avatar: string };
}>("/api/users", async (request) => {
  const { name, avatar } = request.body;

  // Check if a user with the same name already exists in the database
  const existing = db.prepare("SELECT id, name, avatar, role, enabled FROM users WHERE name = ?").get(name) as
    | { id: string; name: string; avatar: string; role: string; enabled: number }
    | undefined;

  if (existing) {
    if (existing.enabled === 0) {
      // Restore the soft-deleted user (and update their avatar to the newly generated one)
      db.prepare("UPDATE users SET enabled = 1, avatar = ? WHERE id = ?").run(avatar, existing.id);
      return { id: existing.id, name: existing.name, avatar, role: existing.role };
    }
    // If already active, just return the existing active user
    return { id: existing.id, name: existing.name, avatar: existing.avatar, role: existing.role };
  }

  const id = "u-" + randomUUID().slice(0, 8);
  const role = "member";
  db.prepare("INSERT INTO users (id, name, avatar, role, enabled) VALUES (?, ?, ?, ?, 1)").run(id, name, avatar, role);
  return { id, name, avatar, role };
});

app.delete<{
  Params: { userId: string };
}>("/api/users/:userId", async (request) => {
  const { userId } = request.params;
  db.prepare("UPDATE users SET enabled = 0 WHERE id = ?").run(userId);
  return { ok: true };
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

app.delete<{
  Params: { bookId: string };
  Querystring: { userId?: string };
}>("/api/books/:bookId/progress", async (request) => {
  const { bookId } = request.params;
  const userId = request.query.userId ?? "u-1";

  db.prepare("DELETE FROM book_progress WHERE user_id = ? AND book_id = ?").run(userId, bookId);

  return { ok: true };
});

app.put<{
  Params: { bookId: string };
  Body: { cover: string };
}>("/api/books/:bookId/cover", async (request, reply) => {
  const { bookId } = request.params;
  const { cover } = request.body;

  const book = db.prepare("SELECT file_path AS filePath FROM books WHERE id = ?").get(bookId) as
    | { filePath: string }
    | undefined;
  if (!book) {
    return reply.code(404).send({ error: "book_not_found" });
  }

  const matches = cover.match(/^data:image\/([a-zA-Z0-9]+);base64,(.+)$/);
  if (!matches) {
    return reply.code(400).send({ error: "invalid_format" });
  }

  const ext = "." + matches[1];
  const buffer = Buffer.from(matches[2], "base64");

  const dir = join(process.cwd(), "data", "covers");
  await mkdir(dir, { recursive: true });
  const fileName = `${bookId}${ext}`;
  const assetPath = join(dir, fileName);
  await writeFile(assetPath, buffer);

  const coverPath = `/assets/covers/${fileName}`;
  db.prepare("UPDATE books SET cover_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(coverPath, bookId);

  return { ok: true, coverPath };
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

app.get<{ Querystring: { userId: string; kind?: "music" | "podcast" } }>("/api/audio/recent", async (request) => {
  const userId = request.query.userId;
  const kind = request.query.kind ?? "music";
  if (!userId) return [];
  return db
    .prepare(
      `
      SELECT t.id, t.title, t.artist, t.album, t.duration, t.cover_path AS coverPath, t.kind, ap.position
      FROM audio_tracks t
      JOIN audio_progress ap ON ap.track_id = t.id AND ap.user_id = ?
      WHERE t.kind = ?
      ORDER BY ap.updated_at DESC
      LIMIT 20
    `
    )
    .all(userId, kind);
});

app.put<{
  Params: { trackId: string };
  Body: { 
    userId: string; 
    position: number; 
    track?: {
      title: string;
      artist?: string;
      album?: string;
      duration?: number;
      coverPath?: string;
      kind?: string;
      filePath?: string;
    }
  };
}>("/api/audio/:trackId/progress", async (request) => {
  const { trackId } = request.params;
  const { userId, position, track } = request.body;

  db.transaction(() => {
    if (track) {
      const existing = db.prepare("SELECT id FROM audio_tracks WHERE id = ? OR file_path = ?").get(trackId, track.filePath ?? trackId);
      if (!existing) {
        db.prepare(`
          INSERT INTO audio_tracks (id, file_path, title, artist, album, duration, cover_path, kind)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          trackId,
          track.filePath ?? trackId,
          track.title,
          track.artist ?? null,
          track.album ?? null,
          track.duration ?? null,
          track.coverPath ?? null,
          track.kind ?? "podcast"
        );
      }
    }

    db.prepare(`
      INSERT INTO audio_progress (user_id, track_id, position, updated_at)
      VALUES (@userId, @trackId, @position, CURRENT_TIMESTAMP)
      ON CONFLICT(user_id, track_id) DO UPDATE SET
        position = excluded.position,
        updated_at = CURRENT_TIMESTAMP
    `).run({ userId, trackId, position });
  })();

  return { ok: true };
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
