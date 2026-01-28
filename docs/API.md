# Local Cloud API

This API powers the web UI and is intended to be reused by desktop/mobile clients. Paths are stable under `/api` (no versioned prefix). Versioning is provided via headers and the `/api/info` response. A starter OpenAPI document lives in `docs/openapi.json`.

## Conventions

### Base URL
- Default: `http://localhost:4170`

### Auth
- Bearer token in `Authorization: Bearer <token>`
- Session cookie `lc_token` (HttpOnly) is set on login for browser-based media requests
- Query string tokens are disabled by default; enable with `allowQueryToken` in `config.json` if needed
- If `devMode` is true, auth is bypassed

### Response Envelope (JSON endpoints)
All JSON endpoints return:

```
{
  "ok": true,
  "data": { ... },
  "meta": { ... } // optional
}
```

Errors use:

```
{
  "ok": false,
  "error": {
    "code": "invalid_request",
    "message": "Human readable message",
    "details": { ... } // optional
  }
}
```

### Pagination
Endpoints returning lists include:

```
{
  "items": [ ... ],
  "total": 123,
  "limit": 50,
  "offset": 0,
  "nextCursor": "..."
}
```

You can use cursor pagination by sending `cursor` instead of `offset`. When `cursor` is present, the server returns `nextCursor` for the next page.
To skip expensive COUNT queries on large datasets, pass `includeTotal=false` (the `total` field will be `null`).

### Versioning
- `X-Api-Version` and `X-Server-Version` headers are returned on `/api/*` requests
- `/api/info` includes `apiVersion` and `serverVersion`

### Common Query Params
- `root` = root id or `__all__` for multi-root queries (supported on search/media/trash)
- `limit`, `offset` for pagination
- `cursor` for keyset pagination (omit `offset` when using)
- `includeTotal` = `false` to skip total counts (returns `total: null`)
- `pathPrefix` for filtering a subtree

---

## Health & Info

### `GET /api/health`
Checks server health and dev mode.

**Response**
```
{ "ok": true, "data": { "status": "ok", "devMode": true, "apiVersion": 1, "serverVersion": "0.1.0" } }
```

### `GET /api/info`
Server capabilities and limits.

**Response**
```
{ "ok": true, "data": { "apiVersion": 1, "serverVersion": "0.1.0", "capabilities": { ... } } }
```

### `GET /api/bootstrap`
Fetches info + roots + status in one request (useful for mobile/desktop clients).

**Response**
```
{
  "ok": true,
  "data": {
    "info": { "apiVersion": 1, "serverVersion": "0.1.0", "capabilities": { ... } },
    "roots": [{ "id": "root", "name": "Drive", "path": "/mnt/drive", "absPath": "/mnt/drive" }],
    "status": { "lastScanAt": 0, "scanInProgress": false, "scanIntervalSeconds": 60 }
  }
}
```

---

## Auth

### `POST /api/login`
Body: `{ "user": "admin", "pass": "admin" }`

**Response**
```
{ "ok": true, "data": { "token": "..." } }
```

### `POST /api/logout`
Revokes token (client should drop it).

---

## Roots

### `GET /api/roots`
List configured roots.

### `PUT /api/roots`
Body: `{ "roots": [{ "id": "", "name": "", "path": "" }] }`

---

## Files

### `GET /api/list`
List children of a directory.

Query:
- `root` (required)
- `path` (relative, default "")
- `limit`, `offset`, `cursor`, `includeTotal`

### `GET /api/search`
Search by name (and audio metadata for music).

Query:
- `root` (`__all__` supported)
- `q` (required)
- `type` = `all | photos | music`
- `pathPrefix` (optional)
- `limit`, `offset`, `cursor`, `includeTotal`

### `GET /api/file`
Stream or download a file.

Query:
- `root` (required)
- `path` (required)
- `download=1` to force download

Supports HTTP range requests for media.

### `POST /api/zip`
Bulk download a zip of files or folders.

Body:
```
{ "root": "rootId", "paths": ["a/b", "c/d"], "flatten": false }
```

---

## Media

### `GET /api/media`
List photos or music.

Query:
- `root` (`__all__` supported)
- `type` = `photos | music`
- `pathPrefix` (optional)
- `limit`, `offset`, `cursor`, `includeTotal`

### `GET /api/preview`
Image/video preview (JPEG thumbnail). Video previews require ffmpeg in the server container.

Query:
- `root`, `path`

---

## Music

### `GET /api/music/albums`
### `GET /api/music/artists`
### `GET /api/music/album`
### `GET /api/music/artist`

Use `root`, `pathPrefix`, and pagination where applicable.

---

## Scanning

### `POST /api/scan`
Trigger a scan.

Body:
```
{ "root": "rootId", "path": "", "mode": "incremental|fast|full|rehash" }
```

### `GET /api/status`
Returns indexer status.

### `GET /api/scan/settings`
### `PUT /api/scan/settings`

---

## Uploads (Chunked + Resumable)

### `GET /api/upload/status`
Check current upload state for a file.

Query:
- `root`, `path`, `file`, `size`, `overwrite=0|1`

Response `data`:
- `status`: `ready | complete | exists`
- `offset`: current bytes uploaded
- `size`: total bytes

### `POST /api/upload/chunk`
Upload a chunk at a given offset.

Query:
- `root`, `path`, `file`, `size`, `offset`, `overwrite=0|1`

Body: raw bytes (`Content-Type: application/octet-stream`)

Response `data`:
- `offset`: new offset
- `complete`: boolean

## Trash (Recycle Bin)

### `GET /api/trash`
List trashed items.

Query:
- `root=__all__` or specific root id
- `limit`, `offset`

### `GET /api/trash/file`
Stream a trashed file for preview/download.

Query:
- `id` or `trashId`
- `download=1` for attachment

### `POST /api/delete`
Soft delete (move to trash).

Body:
```
{ "root": "rootId", "paths": ["a/b", "c/d"] }
```

### `POST /api/trash/restore`
Restore trashed items.

Body:
```
{ "ids": [1,2,3] }
```

### `POST /api/trash/delete`
Permanently delete trashed items.

Body:
```
{ "ids": [1,2,3] }
```

### `POST /api/trash/clear`
Empty trash.

Body:
```
{ "root": "__all__" }
```

---

## Error Codes (common)
- `auth_required`
- `invalid_request`
- `invalid_root`
- `invalid_path`
- `not_found`
- `exists`
- `upload_disabled`
- `upload_failed`
- `preview_failed`
- `unsupported_media`
- `offset_mismatch`
