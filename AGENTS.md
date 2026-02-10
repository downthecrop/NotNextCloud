## Nextcloud Alternative: Plan, Testing, Tuning

### Current Status (V1 Build)
- **Stack:** Node + Fastify backend, SQLite (better-sqlite3) metadata, Vue 3 + Vite frontend.
- **Runs via Docker:** `docker compose up -d --build` serves UI at `http://localhost:4170`.
- **Config:** `config.json` defines `roots`, `dbPath`, `previewDir`, `auth`, `devMode` (currently true).
- **Views:** Files, Photos, Music with hash routing (`/#files`, `/#photos`, `/#music`, plus album/artist states).
- **Media:** Previews for images, native browser playback for video/audio. OPUS supported.
- **Indexing:** SQLite tracks paths, size, mtime, mime, audio metadata (album/artist/title/duration).
- **Album Art:** Embedded art or folder art (`cover.*`/`folder.*`) cached in SQLite; fallback icon in player on error.
- **Bulk:** ZIP download for selected files.

### Goals and Scope
- Local-only deployment with a web UI and basic authentication.
- Disk location support (e.g., `/mnt/SSD`) with indexing, previews, and search.
- SQLite database for file metadata, with periodic cleanup/validation.
- Vue (latest syntax) frontend, familiar file-browser UI (Finder/Drive/OneDrive).
- Bulk download as ZIP; modern image formats (avif, webp) and video playback.
- Backend runs as a service; logs a simple "bind" message on startup.

### Proposed Architecture
- **Backend:** Node.js + Fastify for HTTP API and static assets.
- **Indexer:** Background worker that scans configured roots, stores metadata, and
  generates previews/thumbnails.
- **Storage:** SQLite DB for file metadata, tags, and preview cache entries.
- **Frontend:** Vue 3 + Vite, router-based file browser with breadcrumb navigation.
- **Media:** Browser native playback for videos; generate previews for images and
  store cached thumbnails on disk.

### Milestones (Order of Work)
1) **Backend skeleton** (done)
   - Config for storage roots and basic auth.
   - HTTP server with `/api/health` and `/api/bind` message.
2) **SQLite schema + indexing** (done)
   - File table with path, size, mtime, mime, hash (optional), preview path.
   - Indexer scans roots, updates DB, deletes missing entries.
3) **API endpoints** (done)
   - List directory contents, file metadata, search, download.
   - Bulk download ZIP for selected files.
4) **Preview pipeline** (done)
   - Generate image thumbnails for common formats (including avif/webp).
   - Video poster frames if feasible (otherwise fallback to generic icon).
5) **Vue 3 UI** (done)
   - Finder-like list/grid views, breadcrumbs, search, selection.
   - Bulk download action and file preview panel.
6) **Authentication** (done; devMode bypass available)
   - Basic auth protection for all routes.
7) **Polish + tuning** (ongoing)
   - Caching, incremental indexing, performance tuning.
   - Accessibility and mobile usability pass.

### Detailed Implementation Plan
- **Backend**
  - Use a config file (`config.json` or env) with root paths and auth creds.
  - Implement a file scanner using async streams and a filesystem walker.
  - Use `mime` library to detect file types (including avif/webp).
  - Store DB in app data dir; store previews in `data/previews/`.
  - Expose REST endpoints:
    - `GET /api/list?path=/` -> children metadata
    - `GET /api/search?q=...`
    - `GET /api/file?path=...` -> download/stream
    - `POST /api/zip` -> array of paths, returns zip stream
    - `GET /api/preview?path=...`
  - Log "bind <host:port>" on startup.
- **Indexer**
  - Full scan on startup, then periodic rescan or file watcher.
  - Clean missing entries on rescan.
  - Store file metadata: `path`, `parent`, `name`, `ext`, `size`, `mtime`,
    `mime`, `is_dir`, `preview_path`.
- **Preview Generation**
  - Image thumbnails via `sharp` (supports avif/webp).
  - Video previews optional using `ffmpeg` (if installed), else fallback.
  - Cache thumbnails by hashing `path+mtime`.
- **Frontend (Vue 3)**
  - File browser with breadcrumbs, sidebar roots, list/grid toggle.
  - Search field with live results.
  - Selection model (multi-select) and "Download ZIP" action.
  - File preview panel: images, video, and download link for others.
  - Use modern Vue 3 composition API and `<script setup>`.

### Where Things Live
- **Backend:** `server/server.js`, `server/indexer.js`, `server/db.js`, `server/config.js`
- **Frontend:** `clients/web/src/App.vue`, `clients/web/src/views/FilesView.vue`, `clients/web/src/views/PhotosView.vue`, `clients/web/src/views/MusicView.vue`, `clients/web/src/style.css`
- **Data:** `data/metadata.sqlite` and `data/previews/`

### Current UX Notes
- **Files:** Sidebar shows storage roots; list/grid supports single-click folder navigation and multi-select for ZIP.
- **Photos:** Timeline with date grouping; fullscreen modal with zoom, download, metadata.
- **Music:** Spotify-like layout, sidebar library tabs, player bar with seek + volume.
- **Preview modal:** Files view uses the same fullscreen modal for image/video/audio.

### Next Directions (Short Term)
- Sidebar placeholders (Photos/Music) are UI-only; wire album/pinned locations later.
- Consider unifying "root" as a single pool for Photos/Music (no root switching).
- Add settings actions: rescan, rebuild thumbnails, rescan music (hooks already in Settings modal).
- Improve fallback for missing/failed previews where needed (video thumbs, audio art).

### Testing Plan
- **Unit**
  - Indexer file scanning logic and DB update operations.
  - Preview cache naming and invalidation.
- **Integration**
  - API responses for list/search/zip.
  - Authentication required across all endpoints.
  - Preview generation for avif/webp and a few common video types.
- **Manual**
  - UI navigation on desktop and mobile.
  - Bulk ZIP download for mixed image/video selections.
  - Validate rescans after file changes on disk.

### Tuning and Hardening
- Cache DB queries with indices on `path`, `parent`, and `name`.
- Debounce filesystem events; background rescan cadence.
- Limit ZIP size or add streaming to avoid memory spikes.
- Add request logging and error handling.
- Ensure previews fall back gracefully when generation fails.

### Open Questions
- Exact root directories and whether they can be modified at runtime.
- Preferred auth config source (env vs config file).
- Should we include a lightweight reverse proxy or rely on direct binding.

### Android Client (Expo) - Simple Setup
- The Android client is located in `clients/android` and uses Expo Router
- Make sure the server container is running: `docker ps` (should show notnextcloud2-local-cloud on port 4170)
- Navigate to the Android client directory: `cd clients/android`
- Install dependencies: `npm install`
- Make sure an Android emulator is running: `adb devices` (should show a device)
- Run the app with the correct server URL:
  - Emulator: `EXPO_PUBLIC_API_URL=http://10.0.2.2:4170 npm run android`
  - Physical device: `EXPO_PUBLIC_API_URL=http://YOUR_HOST_IP:4170 npm run android`
- Start Metro (dev client):
  - Emulator: `EXPO_PUBLIC_API_URL=http://10.0.2.2:4170 npx expo start --dev-client`
  - Physical device: `EXPO_PUBLIC_API_URL=http://YOUR_HOST_IP:4170 npx expo start --dev-client`
- The app will connect to the server running in the Docker container

### Android Debugging Notes (Session Learnings)
- If you see `development server returned response error code: 500`, the Metro bundler is often missing a native module. Ensure `react-native-gesture-handler` is installed (`npm install react-native-gesture-handler`) and that the app imports `react-native-gesture-handler` at the top of `clients/android/app/_layout.tsx`.
- When using gesture handler, the app root must be wrapped in `GestureHandlerRootView` (done in `clients/android/app/_layout.tsx`).
- If the app "crashes instantly" with repeated `ReactNativeJNI ... Failed to connect to /10.0.2.2:8081`, Metro is not reachable (not a native crash). Start Metro in a separate terminal and keep it running: `EXPO_PUBLIC_API_URL=http://10.0.2.2:4170 npx expo start --dev-client --clear`, then relaunch the app (`adb shell monkey -p com.brycematthes.android 1` or `npm run android`).

### Workflow Note
- After any code change, reboot Docker (`docker compose up -d --build`) before sending the final response. Do not send the final response until the Docker restart attempt has been made.
