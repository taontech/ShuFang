import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function openDatabase() {
  const dataDir = join(process.cwd(), "data");
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(join(dataDir, "covers"), { recursive: true });

  const db = new Database(join(dataDir, "shufang.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  migrate(db);
  seed(db);

  return db;
}

function migrate(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      avatar TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS books (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      author TEXT,
      cover_path TEXT,
      description TEXT,
      language TEXT,
      file_type TEXT NOT NULL DEFAULT 'epub',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS book_progress (
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      cfi TEXT NOT NULL,
      percentage REAL NOT NULL DEFAULT 0,
      chapter_title TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, book_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reading_activity (
      user_id TEXT NOT NULL,
      day TEXT NOT NULL,
      seconds INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, day),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bookmarks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      book_id TEXT NOT NULL,
      cfi TEXT NOT NULL,
      title TEXT,
      note TEXT,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS audio_tracks (
      id TEXT PRIMARY KEY,
      file_path TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      artist TEXT,
      album TEXT,
      duration REAL,
      cover_path TEXT,
      kind TEXT NOT NULL DEFAULT 'music',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS audio_progress (
      user_id TEXT NOT NULL,
      track_id TEXT NOT NULL,
      position REAL NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, track_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (track_id) REFERENCES audio_tracks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS scan_roots (
      id TEXT PRIMARY KEY,
      path TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS smb_roots (
      id TEXT PRIMARY KEY,
      host TEXT NOT NULL,
      port INTEGER NOT NULL DEFAULT 445,
      username TEXT,
      password TEXT,
      share_name TEXT NOT NULL,
      path TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      last_scanned_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  addColumn(db, "books", "description", "TEXT");
  addColumn(db, "books", "file_type", "TEXT NOT NULL DEFAULT 'epub'");
  addColumn(db, "scan_roots", "last_scanned_at", "TEXT");
  addColumn(db, "users", "enabled", "INTEGER NOT NULL DEFAULT 1");
}

function seed(db: Database.Database) {
  const insertUser = db.prepare(`
    INSERT OR IGNORE INTO users (id, name, avatar, role)
    VALUES (@id, @name, @avatar, @role)
  `);

  insertUser.run({ id: "u-1", name: "陶宁", avatar: "T", role: "admin" });
  insertUser.run({ id: "u-2", name: "家人", avatar: "J", role: "member" });
  insertUser.run({ id: "system", name: "System", avatar: "S", role: "admin" });
}

function addColumn(db: Database.Database, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  if (!columns.some((item) => item.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}
