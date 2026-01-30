# Android Client Contract

This doc captures the expected client behavior and API usage for the Android app.
It assumes the server runs the Local Cloud API under `/api`.

## Boot + Auth
- Call `GET /api/health` to detect dev mode.
- If `devMode` is false, authenticate with `POST /api/login` and store the bearer token.
- Use `Authorization: Bearer <token>` for all JSON requests.
- Use query tokens only if `allowQueryToken` is enabled (primarily for media URLs).

## Startup
- Call `GET /api/bootstrap` once on launch.
  - Use `info.capabilities` to drive feature flags (upload, trash, pagination, etc).
  - Use `roots` to populate tabs and default root selection.
  - Use `status` to show indexing progress if needed.

## Navigation + Pagination
- Files list: `GET /api/list?root=<id>&path=<relPath>`.
- Search: `GET /api/search?root=<id|__all__>&q=...`.
- Media: `GET /api/media?root=<id|__all__>&type=photos|music`.
- Prefer cursor pagination when `nextCursor` is returned (send `cursor` instead of `offset`).
- Use `includeTotal=false` to avoid count overhead for large datasets.

## Media Preview + Playback
- Images/videos: `GET /api/preview?root=<id>&path=<relPath>` (returns JPEG thumbnails).
- Full file stream: `GET /api/file?root=<id>&path=<relPath>` (supports HTTP range requests).
- For downloads, add `download=1` to `/api/file`.

## Uploads (Chunked + Resumable)
- Status check: `GET /api/upload/status` with:
  - `root`, `size`, `overwrite=0|1`
  - either `path` + `file` or `target` (full relative path)
- Upload chunk: `POST /api/upload/chunk` with:
  - `root`, `size`, `offset`, `overwrite=0|1`
  - either `path` + `file` or `target`
  - body: raw bytes (`Content-Type: application/octet-stream`)
- If response is `offset_mismatch`, retry using `expectedOffset`.

## Camera Sync (Recommended)
- Use WorkManager + foreground service for long-running uploads.
- Store a local journal of pending files + upload offsets.
- Compute `target` relative paths based on the user-selected upload folder, e.g.
  `Camera/2026/01/IMG_0001.jpg`.
- Retry uploads on network changes and app restarts.

## Trash
- List: `GET /api/trash?root=<id|__all__>`
- Restore: `POST /api/trash/restore` `{ ids: [...] }`
- Permanently delete: `POST /api/trash/delete` `{ ids: [...] }`
- Stream trashed file: `GET /api/trash/file?id=<trashId>`

## Error Handling
- All JSON responses use `{ ok, data }` and `{ ok:false, error }`.
- Common errors: `auth_required`, `invalid_request`, `invalid_root`, `invalid_path`, `not_found`.
- Upload errors: `exists`, `upload_disabled`, `offset_mismatch`.

## Versioning
- Read `X-Api-Version` and `X-Server-Version` headers for diagnostics.
- `/api/info` exposes capabilities for feature detection.
