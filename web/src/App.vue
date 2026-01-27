<script setup>
import { ref, computed, provide, onMounted, watch } from 'vue';
import LoginView from './components/LoginView.vue';
import SettingsModal from './components/SettingsModal.vue';
import FilesView from './views/FilesView.vue';
import PhotosView from './views/PhotosView.vue';
import MusicView from './views/MusicView.vue';
import { formatDate } from './utils/formatting';
import { parseHash, buildHash } from './utils/hashNav';

const token = ref(localStorage.getItem('localCloudToken') || '');
const devMode = ref(false);
const authReady = ref(false);
const roots = ref([]);
const currentRoot = ref(null);
const currentView = ref('files');
const musicNav = ref({ mode: 'songs', albumKey: null, artist: null, playlistId: null });
const filesNav = ref({ rootId: null, path: '', token: 0 });
const musicJump = ref({ rootId: null, path: '', token: 0 });
const photosJump = ref({ rootId: null, path: '', token: 0 });
const settingsOpen = ref(false);
const pageSize = ref(parseInt(localStorage.getItem('localCloudPageSize') || '50', 10) || 50);
const apiInfo = ref(null);
const uploadOverwrite = ref(localStorage.getItem('localCloudUploadOverwrite') === 'true');
const status = ref({
  lastScanAt: null,
  scanInProgress: false,
  scanIntervalSeconds: 0,
  fastScan: true,
  fullScanIntervalHours: 0,
});
const allRoot = computed(() => ({ id: '__all__', name: 'All Roots' }));
const mediaRoot = computed(() => (currentView.value === 'files' ? currentRoot.value : allRoot.value));

const isAuthenticated = computed(() => Boolean(token.value) || devMode.value);
const uploadEnabled = computed(() => apiInfo.value?.capabilities?.upload?.enabled !== false);
const uploadChunkBytes = computed(
  () => apiInfo.value?.capabilities?.upload?.chunkBytes || 8 * 1024 * 1024
);

function setToken(value) {
  token.value = value || '';
  if (token.value) {
    localStorage.setItem('localCloudToken', token.value);
  } else {
    localStorage.removeItem('localCloudToken');
  }
}

function setUploadOverwrite(value) {
  uploadOverwrite.value = Boolean(value);
  localStorage.setItem('localCloudUploadOverwrite', uploadOverwrite.value ? 'true' : 'false');
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token.value) {
    headers.set('Authorization', `Bearer ${token.value}`);
  }
  const isBinaryBody =
    options.body instanceof FormData ||
    options.body instanceof Blob ||
    options.body instanceof ArrayBuffer ||
    ArrayBuffer.isView(options.body);
  if (options.body && !headers.has('Content-Type') && !isBinaryBody) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    setToken('');
  }
  return response;
}

async function apiJson(url, options = {}) {
  const res = await apiFetch(url, options);
  let payload = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }
  if (payload && typeof payload === 'object' && 'ok' in payload) {
    if (!payload.ok) {
      return {
        ok: false,
        status: res.status,
        error: payload.error || { message: 'Request failed' },
      };
    }
    return {
      ok: true,
      status: res.status,
      data: payload.data,
      meta: payload.meta || null,
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      error: payload?.error || { message: 'Request failed' },
    };
  }
  return { ok: true, status: res.status, data: payload, meta: null };
}

provide('apiFetch', apiFetch);
provide('apiJson', apiJson);
provide('authToken', token);

async function login({ user, pass }) {
  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass }),
    });
    if (!res.ok) {
      return false;
    }
    const payload = await res.json();
    if (!payload?.ok) {
      return false;
    }
    setToken(payload.data?.token);
    await loadRoots();
    return true;
  } catch {
    return false;
  }
}

async function logout() {
  await apiFetch('/api/logout', { method: 'POST' });
  setToken('');
}

async function loadStatus() {
  const result = await apiJson('/api/status');
  if (!result.ok) {
    return;
  }
  status.value = result.data;
}

async function loadInfo() {
  const result = await apiJson('/api/info');
  if (!result.ok) {
    return;
  }
  apiInfo.value = result.data;
}

async function updateScanSettings(nextSettings) {
  const result = await apiJson('/api/scan/settings', {
    method: 'PUT',
    body: JSON.stringify(nextSettings),
  });
  if (!result.ok) {
    const message = result.error?.message || 'Failed to update scan settings.';
    return { ok: false, error: message };
  }
  status.value = result.data;
  return { ok: true };
}
async function loadRoots() {
  if (!token.value && !devMode.value) {
    return;
  }
  const result = await apiJson('/api/roots');
  if (!result.ok) {
    return;
  }
  roots.value = result.data;
  if (!currentRoot.value && roots.value.length) {
    currentRoot.value = roots.value[0];
  }
  await loadStatus();
  await loadInfo();
}

async function updateRoots(nextRoots) {
  const result = await apiJson('/api/roots', {
    method: 'PUT',
    body: JSON.stringify({
      roots: nextRoots.map((root) => ({
        id: root.id,
        name: root.name,
        path: root.path,
      })),
    }),
  });
  if (!result.ok) {
    const message = result.error?.message || 'Failed to update roots.';
    return { ok: false, error: message };
  }
  roots.value = result.data;
  if (!roots.value.find((root) => root.id === currentRoot.value?.id)) {
    currentRoot.value = roots.value[0] || null;
  }
  await loadStatus();
  return { ok: true };
}

function selectRoot(root) {
  currentRoot.value = root;
}

function onPageSizeChange(value) {
  const parsed = Math.min(Math.max(parseInt(value, 10) || 50, 25), 200);
  pageSize.value = parsed;
  localStorage.setItem('localCloudPageSize', String(parsed));
}

function applyHash() {
  const parsed = parseHash(window.location.hash);
  currentView.value = parsed.view;
  musicNav.value = parsed.music;
  if (parsed.view === 'files') {
    filesNav.value = {
      rootId: parsed.files?.rootId || null,
      path: parsed.files?.path || '',
      token: Date.now(),
    };
  }
}

function setHash(view, music) {
  const next = buildHash({ view, music, files: filesNav.value });
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

function setView(view) {
  currentView.value = view;
  setHash(view, musicNav.value);
}

function openInFiles({ rootId, path }) {
  const root = roots.value.find((item) => item.id === rootId);
  if (root) {
    currentRoot.value = root;
  }
  filesNav.value = {
    rootId: rootId || null,
    path: path || '',
    token: Date.now(),
  };
  setView('files');
}

function openInMusic({ rootId, path, albumKey }) {
  const nextMode = albumKey ? 'albums' : 'songs';
  musicNav.value = {
    mode: nextMode,
    albumKey: albumKey || null,
    artist: null,
    playlistId: null,
  };
  musicJump.value = {
    rootId: rootId || null,
    path: path || '',
    mode: nextMode,
    albumKey: albumKey || null,
    token: Date.now(),
  };
  setView('music');
}

function openInPhotos({ rootId, path }) {
  photosJump.value = {
    rootId: rootId || null,
    path: path || '',
    token: Date.now(),
  };
  setView('photos');
}

function updateMusicNav(next) {
  musicNav.value = { ...musicNav.value, ...next };
  if (currentView.value === 'music') {
    setHash('music', musicNav.value);
  }
}

async function rescan(scope) {
  const result = await apiJson(`/api/scan?scope=${encodeURIComponent(scope)}`, { method: 'POST' });
  if (result.ok) {
    status.value = result.data?.status || status.value;
  }
}

async function rebuildThumbs() {
  await apiJson('/api/previews/rebuild', { method: 'POST' });
}

watch(token, (value) => {
  if (!value && !devMode.value) {
    roots.value = [];
    currentRoot.value = null;
    currentView.value = 'files';
    apiInfo.value = null;
  }
});

watch(currentView, (view) => {
  if (view !== 'photos' && photosJump.value.path) {
    photosJump.value = { rootId: null, path: '', token: 0 };
  }
});

onMounted(() => {
  fetch('/api/health')
    .then((res) => res.json())
    .then((payload) => {
      if (payload?.ok) {
        devMode.value = Boolean(payload.data?.devMode);
      } else {
        devMode.value = false;
      }
    })
    .catch(() => {
      devMode.value = false;
    })
    .finally(() => {
      if (token.value || devMode.value) {
        loadRoots();
      }
      authReady.value = true;
    });
  applyHash();
  window.addEventListener('hashchange', applyHash);
});

watch(
  [() => roots.value, () => filesNav.value.rootId, () => currentView.value],
  () => {
    if (currentView.value !== 'files') {
      return;
    }
    if (!filesNav.value.rootId) {
      return;
    }
    if (currentRoot.value?.id === filesNav.value.rootId) {
      return;
    }
    const root = roots.value.find((item) => item.id === filesNav.value.rootId);
    if (root) {
      currentRoot.value = root;
    }
  }
);
</script>

<template>
  <LoginView v-if="authReady && !isAuthenticated" :on-login="login" />

  <div v-else-if="isAuthenticated" class="app-shell">
    <header class="top-bar">
      <div class="brand-group">
        <button class="brand" type="button" @click="setView('files')" aria-label="Go to Files">
          <span class="sr-only">Local Cloud</span>
          <i class="fa-solid fa-cloud"></i>
        </button>
        <div class="view-tabs">
          <button :class="{ active: currentView === 'files' }" @click="setView('files')">
            Files
          </button>
          <button :class="{ active: currentView === 'photos' }" @click="setView('photos')">
            Photos
          </button>
          <button :class="{ active: currentView === 'music' }" @click="setView('music')">
            Music
          </button>
        </div>
      </div>
      <div class="top-actions">
        <button class="icon-btn" @click="settingsOpen = true" aria-label="Settings">
          <i class="fa-solid fa-gear"></i>
        </button>
        <button v-if="!devMode" class="action-btn secondary" @click="logout">Sign out</button>
      </div>
    </header>

    <FilesView
      v-if="currentView === 'files'"
      :roots="roots"
      :current-root="currentRoot"
      :nav-state="filesNav"
      :page-size="pageSize"
      :upload-enabled="uploadEnabled"
      :upload-overwrite="uploadOverwrite"
      :upload-chunk-bytes="uploadChunkBytes"
      :on-select-root="selectRoot"
      :on-open-in-music="openInMusic"
      :on-open-in-photos="openInPhotos"
    />

    <PhotosView
      v-else-if="currentView === 'photos'"
      :roots="roots"
      :current-root="mediaRoot"
      :jump-to="photosJump"
      :page-size="pageSize"
      :on-select-root="selectRoot"
      :on-open-in-files="openInFiles"
    />

    <MusicView
      v-else
      :roots="roots"
      :current-root="mediaRoot"
      :jump-to="musicJump"
      :page-size="pageSize"
      :on-select-root="selectRoot"
      :on-open-in-files="openInFiles"
      :nav-state="musicNav"
      :on-navigate="updateMusicNav"
    />

    <SettingsModal
      :open="settingsOpen"
      :roots="roots"
      :page-size="pageSize"
      :status="status"
      :api-info="apiInfo"
      :upload-overwrite="uploadOverwrite"
      :format-date="formatDate"
      :on-close="() => (settingsOpen = false)"
      :on-page-size-change="onPageSizeChange"
      :on-update-roots="updateRoots"
      :on-update-scan-settings="updateScanSettings"
      :on-upload-overwrite-change="setUploadOverwrite"
      :on-rescan-files="() => rescan('files')"
      :on-rescan-music="() => rescan('music')"
      :on-rebuild-thumbs="rebuildThumbs"
    />
  </div>
</template>
