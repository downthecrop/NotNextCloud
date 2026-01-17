<script setup>
import { ref, computed, provide, onMounted, watch } from 'vue';
import LoginView from './components/LoginView.vue';
import SettingsModal from './components/SettingsModal.vue';
import FilesView from './views/FilesView.vue';
import PhotosView from './views/PhotosView.vue';
import MusicView from './views/MusicView.vue';

const token = ref(localStorage.getItem('localCloudToken') || '');
const devMode = ref(false);
const authReady = ref(false);
const roots = ref([]);
const currentRoot = ref(null);
const currentView = ref('files');
const musicNav = ref({ mode: 'songs', albumKey: null, artist: null, playlistId: null });
const settingsOpen = ref(false);
const pageSize = ref(parseInt(localStorage.getItem('localCloudPageSize') || '50', 10) || 50);
const status = ref({ lastScanAt: null, scanInProgress: false, scanIntervalSeconds: 0 });

const isAuthenticated = computed(() => Boolean(token.value) || devMode.value);

function setToken(value) {
  token.value = value || '';
  if (token.value) {
    localStorage.setItem('localCloudToken', token.value);
  } else {
    localStorage.removeItem('localCloudToken');
  }
}

async function apiFetch(url, options = {}) {
  const headers = new Headers(options.headers || {});
  if (token.value) {
    headers.set('Authorization', `Bearer ${token.value}`);
  }
  if (options.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(url, { ...options, headers });
  if (response.status === 401) {
    setToken('');
  }
  return response;
}

provide('apiFetch', apiFetch);
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
    const data = await res.json();
    setToken(data.token);
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
  const res = await apiFetch('/api/status');
  if (!res.ok) {
    return;
  }
  status.value = await res.json();
}

async function loadRoots() {
  if (!token.value && !devMode.value) {
    return;
  }
  const res = await apiFetch('/api/roots');
  if (!res.ok) {
    return;
  }
  roots.value = await res.json();
  if (!currentRoot.value && roots.value.length) {
    currentRoot.value = roots.value[0];
  }
  await loadStatus();
}

function selectRoot(root) {
  currentRoot.value = root;
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return date.toLocaleString();
}

function onPageSizeChange(value) {
  const parsed = Math.min(Math.max(parseInt(value, 10) || 50, 25), 200);
  pageSize.value = parsed;
  localStorage.setItem('localCloudPageSize', String(parsed));
}

function parseHash() {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) {
    return { view: 'files', music: { mode: 'songs', albumKey: null, artist: null, playlistId: null } };
  }
  const parts = raw.split('/').filter(Boolean);
  const view = parts[0];
  if (view === 'music') {
    let mode = 'songs';
    let albumKey = null;
    let artist = null;
    let playlistId = null;
    if (parts[1] === 'albums') {
      mode = 'albums';
      albumKey = parts[2] ? decodeURIComponent(parts[2]) : null;
    } else if (parts[1] === 'artists') {
      mode = 'artists';
      artist = parts[2] ? decodeURIComponent(parts[2]) : null;
    } else if (parts[1] === 'playlists') {
      mode = 'playlists';
      playlistId = parts[2] ? decodeURIComponent(parts[2]) : null;
    }
    return { view, music: { mode, albumKey, artist, playlistId } };
  }
  if (view === 'photos') {
    return { view: 'photos', music: { mode: 'songs', albumKey: null, artist: null, playlistId: null } };
  }
  return { view: 'files', music: { mode: 'songs', albumKey: null, artist: null, playlistId: null } };
}

function buildHash(view, music) {
  if (view === 'music') {
    const mode = music?.mode || 'songs';
    if (mode === 'albums') {
      return music?.albumKey
        ? `#music/albums/${encodeURIComponent(music.albumKey)}`
        : '#music/albums';
    }
    if (mode === 'artists') {
      return music?.artist
        ? `#music/artists/${encodeURIComponent(music.artist)}`
        : '#music/artists';
    }
    if (mode === 'playlists') {
      return music?.playlistId
        ? `#music/playlists/${encodeURIComponent(music.playlistId)}`
        : '#music/playlists';
    }
    return '#music';
  }
  if (view === 'photos') {
    return '#photos';
  }
  return '#files';
}

function applyHash() {
  const parsed = parseHash();
  currentView.value = parsed.view;
  musicNav.value = parsed.music;
}

function setHash(view, music) {
  const next = buildHash(view, music);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}

function setView(view) {
  currentView.value = view;
  setHash(view, musicNav.value);
}

function updateMusicNav(next) {
  musicNav.value = { ...musicNav.value, ...next };
  if (currentView.value === 'music') {
    setHash('music', musicNav.value);
  }
}

async function rescan(scope) {
  const res = await apiFetch(`/api/scan?scope=${encodeURIComponent(scope)}`, { method: 'POST' });
  if (res.ok) {
    const data = await res.json();
    status.value = data.status || status.value;
  }
}

async function rebuildThumbs() {
  await apiFetch('/api/previews/rebuild', { method: 'POST' });
}

watch(token, (value) => {
  if (!value && !devMode.value) {
    roots.value = [];
    currentRoot.value = null;
    currentView.value = 'files';
  }
});

onMounted(() => {
  fetch('/api/health')
    .then((res) => res.json())
    .then((data) => {
      devMode.value = Boolean(data.devMode);
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
</script>

<template>
  <LoginView v-if="authReady && !isAuthenticated" :on-login="login" />

  <div v-else-if="isAuthenticated" class="app-shell">
    <header class="top-bar">
      <div class="brand-group">
        <div class="brand">Local Cloud</div>
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
        <button class="icon-btn" @click="settingsOpen = true">Settings</button>
        <button v-if="!devMode" class="action-btn secondary" @click="logout">Sign out</button>
      </div>
    </header>

    <FilesView
      v-if="currentView === 'files'"
      :roots="roots"
      :current-root="currentRoot"
      :page-size="pageSize"
      :on-select-root="selectRoot"
    />

    <PhotosView
      v-else-if="currentView === 'photos'"
      :roots="roots"
      :current-root="currentRoot"
      :page-size="pageSize"
      :on-select-root="selectRoot"
    />

    <MusicView
      v-else
      :roots="roots"
      :current-root="currentRoot"
      :page-size="pageSize"
      :on-select-root="selectRoot"
      :nav-state="musicNav"
      :on-navigate="updateMusicNav"
    />

    <SettingsModal
      :open="settingsOpen"
      :page-size="pageSize"
      :status="status"
      :format-date="formatDate"
      :on-close="() => (settingsOpen = false)"
      :on-page-size-change="onPageSizeChange"
      :on-rescan-files="() => rescan('files')"
      :on-rescan-music="() => rescan('music')"
      :on-rebuild-thumbs="rebuildThumbs"
    />
  </div>
</template>
