<script setup>
import { ref, computed, provide, onMounted, onUnmounted, watch } from 'vue';
import LoginView from './components/LoginView.vue';
import SettingsModal from './components/SettingsModal.vue';
import FilesView from './views/FilesView.vue';
import PhotosView from './views/PhotosView.vue';
import MusicView from './views/MusicView.vue';
import { createApiClient } from './api/client';
import { formatDate } from './utils/formatting';
import { parseHash, buildHash } from './utils/hashNav';
import { ALL_ROOTS_ID } from './constants';

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
let statusTimer = null;
const pageSize = ref(parseInt(localStorage.getItem('localCloudPageSize') || '50', 10) || 50);
const apiInfo = ref(null);
const uploadOverwrite = ref(localStorage.getItem('localCloudUploadOverwrite') === 'true');
const status = ref({
  lastScanAt: null,
  scanInProgress: false,
  scanIntervalSeconds: 0,
  fastScan: true,
  scanFsConcurrency: 8,
  fullScanIntervalHours: 0,
  scanErrorCount: 0,
  scanErrors: [],
});
const scanToast = ref({
  visible: false,
  title: '',
  message: '',
  detail: '',
});
let scanToastTimer = null;
let scanErrorsInitialized = false;
const seenScanErrorIds = new Set();
const allRoot = computed(() => ({ id: ALL_ROOTS_ID, name: 'All' }));
const fileRoots = computed(() => (roots.value.length ? [allRoot.value, ...roots.value] : []));
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

const apiClient = createApiClient({
  getToken: () => token.value,
  onUnauthorized: () => setToken(''),
  queryToken: false,
});
const apiFetch = apiClient.apiFetch;
const apiJson = apiClient.apiJson;
const apiUrls = apiClient.urls;

function setUploadOverwrite(value) {
  uploadOverwrite.value = Boolean(value);
  localStorage.setItem('localCloudUploadOverwrite', uploadOverwrite.value ? 'true' : 'false');
}

provide('apiClient', apiClient);
provide('apiFetch', apiFetch);
provide('apiJson', apiJson);
provide('apiUrls', apiUrls);
provide('authToken', token);

async function login({ user, pass }) {
  try {
    const res = await apiJson(apiUrls.login(), {
      method: 'POST',
      body: JSON.stringify({ user, pass }),
    });
    if (!res.ok) {
      return false;
    }
    setToken(res.data?.token);
    await loadRoots();
    return true;
  } catch {
    return false;
  }
}

async function logout() {
  await apiFetch(apiUrls.logout(), { method: 'POST' });
  setToken('');
}

async function loadStatus() {
  const result = await apiJson(apiUrls.status());
  if (!result.ok) {
    return;
  }
  applyStatus(result.data);
}

async function loadInfo() {
  const result = await apiJson(apiUrls.info());
  if (!result.ok) {
    return;
  }
  apiInfo.value = result.data;
}

async function updateScanSettings(nextSettings) {
  const result = await apiJson(apiUrls.scanSettings(), {
    method: 'PUT',
    body: JSON.stringify(nextSettings),
  });
  if (!result.ok) {
    const message = result.error?.message || 'Failed to update scan settings.';
    return { ok: false, error: message };
  }
  applyStatus(result.data);
  return { ok: true };
}
async function loadRoots() {
  if (!token.value && !devMode.value) {
    return;
  }
  const result = await apiJson(apiUrls.bootstrap());
  if (!result.ok) {
    return;
  }
  const data = result.data || {};
  roots.value = data.roots || [];
  applyStatus(data.status || status.value, { notifyScanErrors: false });
  apiInfo.value = data.info || apiInfo.value;
  const preferredRoot = filesNav.value?.rootId
    ? roots.value.find((root) => root.id === filesNav.value.rootId)
    : null;
  if (filesNav.value?.rootId === ALL_ROOTS_ID) {
    currentRoot.value = allRoot.value;
  } else if (preferredRoot) {
    currentRoot.value = preferredRoot;
  } else if (!currentRoot.value && roots.value.length) {
    currentRoot.value = roots.value[0];
  }
}

async function updateRoots(nextRoots) {
  const result = await apiJson(apiUrls.roots(), {
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
  if (
    currentRoot.value?.id !== ALL_ROOTS_ID &&
    !roots.value.find((root) => root.id === currentRoot.value?.id)
  ) {
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
    if (filesNav.value.rootId === ALL_ROOTS_ID) {
      currentRoot.value = allRoot.value;
    } else if (filesNav.value.rootId) {
      const match = roots.value.find((root) => root.id === filesNav.value.rootId);
      if (match) {
        currentRoot.value = match;
      }
    }
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

function goFilesRoot() {
  filesNav.value = {
    rootId: currentRoot.value?.id || filesNav.value.rootId || null,
    path: '',
    token: Date.now(),
  };
  setView('files');
}

function openInFiles({ rootId, path }) {
  if (rootId === ALL_ROOTS_ID) {
    currentRoot.value = allRoot.value;
  } else {
    const root = roots.value.find((item) => item.id === rootId);
    if (root) {
      currentRoot.value = root;
    }
  }
  filesNav.value = {
    rootId: rootId || null,
    path: path || '',
    token: Date.now(),
  };
  setView('files');
}

function navigateFiles({ rootId, path }) {
  const nextHash = buildHash({
    view: 'files',
    music: musicNav.value,
    files: { rootId: rootId || null, path: path || '' },
  });
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
  }
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
  const result = await apiJson(apiUrls.scan({ scope }), { method: 'POST' });
  if (result.ok) {
    applyStatus(result.data?.status || status.value);
  }
}

async function rebuildThumbs() {
  await apiJson(apiUrls.previewsRebuild(), { method: 'POST' });
}

watch(token, (value) => {
  if (!value && !devMode.value) {
    roots.value = [];
    currentRoot.value = null;
    currentView.value = 'files';
    apiInfo.value = null;
  }
});

function startStatusPolling() {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  if (!isAuthenticated.value) {
    return;
  }
  loadStatus();
  statusTimer = setInterval(() => {
    if (isAuthenticated.value) {
      loadStatus();
    }
  }, 5000);
}

function rememberScanErrorId(id) {
  if (!id) {
    return;
  }
  if (seenScanErrorIds.size > 1000) {
    seenScanErrorIds.clear();
  }
  seenScanErrorIds.add(id);
}

function showScanErrorToast(errorEntry) {
  if (!errorEntry) {
    return;
  }
  const code = errorEntry.code || 'UNKNOWN';
  const tooManyFiles = code === 'EMFILE' || code === 'ENFILE';
  const location =
    errorEntry.relPath ||
    errorEntry.fullPath ||
    errorEntry.rootName ||
    errorEntry.rootId ||
    '';
  scanToast.value = {
    visible: true,
    title: tooManyFiles ? 'Indexing hit file-handle limits' : `Indexing error (${code})`,
    message: tooManyFiles
      ? 'Too many files are open while scanning this storage. Index results may be incomplete.'
      : errorEntry.message || 'An indexing error occurred.',
    detail: location ? `Path: ${location}` : '',
  };
  if (scanToastTimer) {
    clearTimeout(scanToastTimer);
  }
  scanToastTimer = setTimeout(() => {
    scanToast.value.visible = false;
    scanToastTimer = null;
  }, 9000);
}

function ingestScanErrors(nextStatus, { notifyScanErrors = true } = {}) {
  const errors = Array.isArray(nextStatus?.scanErrors) ? nextStatus.scanErrors : [];
  if (!scanErrorsInitialized) {
    for (const error of errors) {
      rememberScanErrorId(error?.id);
    }
    scanErrorsInitialized = true;
    return;
  }
  let newestUnseen = null;
  for (const error of errors) {
    if (!error?.id || seenScanErrorIds.has(error.id)) {
      continue;
    }
    newestUnseen = error;
    rememberScanErrorId(error.id);
  }
  if (notifyScanErrors && newestUnseen) {
    showScanErrorToast(newestUnseen);
  }
}

function applyStatus(nextStatus, options = {}) {
  if (!nextStatus || typeof nextStatus !== 'object') {
    return;
  }
  ingestScanErrors(nextStatus, options);
  status.value = nextStatus;
}

function dismissScanToast() {
  scanToast.value.visible = false;
}

watch(
  () => isAuthenticated.value,
  () => {
    startStatusPolling();
  },
  { immediate: true }
);

watch(
  () => settingsOpen.value,
  (value) => {
    if (value && isAuthenticated.value) {
      loadStatus();
    }
  }
);

watch(currentView, (view) => {
  if (view !== 'photos' && photosJump.value.path) {
    photosJump.value = { rootId: null, path: '', token: 0 };
  }
});

onMounted(() => {
  apiJson(apiUrls.health())
    .then((result) => {
      if (result?.ok) {
        devMode.value = Boolean(result.data?.devMode);
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

onUnmounted(() => {
  if (statusTimer) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
  if (scanToastTimer) {
    clearTimeout(scanToastTimer);
    scanToastTimer = null;
  }
  window.removeEventListener('hashchange', applyHash);
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
    if (filesNav.value.rootId === ALL_ROOTS_ID) {
      if (currentRoot.value?.id !== ALL_ROOTS_ID) {
        currentRoot.value = allRoot.value;
      }
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
        <button class="brand" type="button" @click="goFilesRoot" aria-label="Go to Files">
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
      :roots="fileRoots"
      :current-root="currentRoot"
      :nav-state="filesNav"
      :page-size="pageSize"
      :upload-enabled="uploadEnabled"
      :upload-overwrite="uploadOverwrite"
      :upload-chunk-bytes="uploadChunkBytes"
      :on-select-root="selectRoot"
      :on-navigate-path="navigateFiles"
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

    <div v-if="scanToast.visible" class="app-toast-stack" role="status" aria-live="polite">
      <div class="app-toast">
        <div class="app-toast-title">{{ scanToast.title }}</div>
        <div class="app-toast-message">{{ scanToast.message }}</div>
        <div v-if="scanToast.detail" class="app-toast-meta">{{ scanToast.detail }}</div>
        <button class="app-toast-close" type="button" @click="dismissScanToast" aria-label="Dismiss">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>
    </div>
  </div>
</template>
