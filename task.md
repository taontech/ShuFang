# SMB Sharing Integration Progress

This task tracks the implementation of full network SMB share support in ShuFang.

## Progress Checklist

- [x] **Dependency Setup**: Installed `@marsaud/smb2` dependency and created type declaration files for strict TS checking.
- [x] **Database Migration**: Added the `smb_roots` table into SQLite schema (`host`, `port`, `username`, `password`, `share_name`, `path`, `enabled`, `last_scanned_at`, `created_at`).
- [x] **Manage API Endpoints**: Created full REST API endpoints for SMB roots (`GET/POST/DELETE /api/roots/smb`) and connection test endpoint (`POST /api/roots/smb/test`).
- [x] **Recursive SMB Scanner**:
  - [x] Developed robust connection helper and promise wrappers for SMB operations.
  - [x] Implemented a recursive directory walk (`walkSmb`) utilizing SMB `readdir` with stats.
  - [x] Coded PDF, EPUB, and audio metadata extraction over SMB.
  - [x] Handled ZIP buffer loading in memory to parse EPUB metadata/covers directly over the network.
  - [x] Standardized stable hashing for SMB URIs (e.g. `smb://{host}/{share_name}/{relativePath}`).
  - [x] Implemented sidecar/folder cover image resolution over SMB shares.
- [x] **SMB Stream & Range Request Support**:
  - [x] Enhanced `/api/books/:bookId/file` and `/api/audio/:trackId/stream` to check for SMB URIs.
  - [x] Integrated raw connection cleanup using Fastify `reply.raw.on("close")` to safely terminate SMB sessions after stream ends/closes.
  - [x] Coded range parsing support to stream audio/EPUB files efficiently, allowing direct reading and media playing over the network without full downloads.
  - [x] Added network sidecar lyrics support (`.lrc` and `.txt` files) for audio tracks stored on SMB.
- [x] **Settings Frontend UI**:
  - [x] Built a gorgeous responsive setting form for adding Network SMB Resource Shares in `SettingsView` (`apps/web/src/main.tsx`).
  - [x] Handled host, port, username, password, share name, and subpath inputs.
  - [x] Wired up a "Test Connection" trigger that feeds direct success or error feedback in real-time.
  - [x] Listed saved SMB connections with stable URIs and scanned status.
  - [x] Integrated network roots scanning into the global `runScan` library sync trigger.

## Quality and Verification
- Both `apps/server` and `apps/web` compile completely cleanly with **zero TypeScript errors** under strict typechecking!
- All endpoints, promise wrappers, and database migrations are fully implemented and integrated.
