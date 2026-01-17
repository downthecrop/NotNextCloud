<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useApi } from '../composables/useApi';
import MiniPlayer from '../components/MiniPlayer.vue';

const props = defineProps({
  roots: {
    type: Array,
    required: true,
  },
  currentRoot: {
    type: Object,
    default: null,
  },
  pageSize: {
    type: Number,
    required: true,
  },
  navState: {
    type: Object,
    default: () => ({ mode: 'songs', albumKey: null, artist: null, playlistId: null }),
  },
  onSelectRoot: {
    type: Function,
    required: true,
  },
  onNavigate: {
    type: Function,
    required: true,
  },
});

const { apiFetch, fileUrl, albumArtUrl } = useApi();

const mode = ref('songs');
const items = ref([]);
const total = ref(0);
const offset = ref(0);
const albums = ref([]);
const albumsTotal = ref(0);
const albumsOffset = ref(0);
const artists = ref([]);
const artistsTotal = ref(0);
const artistsOffset = ref(0);
const searchQuery = ref('');
const searchResults = ref([]);
const searchTotal = ref(0);
const searchOffset = ref(0);
const loading = ref(false);
const error = ref('');
const selectedTrack = ref(null);
const selectedAlbum = ref(null);
const selectedArtist = ref(null);
const playlists = ref([]);
const selectedPlaylistId = ref(null);
const draftCounter = ref(1);
const contextMenu = ref({ open: false, x: 0, y: 0, track: null });
const musicPins = ref([]);
const activePin = ref(null);
const albumTracks = ref([]);
const artistTracks = ref([]);
const sentinel = ref(null);
let observer = null;

const rootId = computed(() => props.currentRoot?.id || '');
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const displaySongs = computed(() => (isSearchMode.value ? searchResults.value : items.value));
const queue = computed(() => {
  if (mode.value === 'songs') {
    return displaySongs.value;
  }
  if (mode.value === 'albums') {
    return albumTracks.value;
  }
  if (mode.value === 'playlists') {
    return playlistTracks.value;
  }
  return artistTracks.value;
});
const filteredAlbums = computed(() => {
  if (!isSearchMode.value) {
    return albums.value;
  }
  const query = searchQuery.value.trim().toLowerCase();
  return albums.value.filter((album) => {
    return (
      album.album?.toLowerCase().includes(query) ||
      album.artist?.toLowerCase().includes(query)
    );
  });
});
const filteredArtists = computed(() => {
  if (!isSearchMode.value) {
    return artists.value;
  }
  const query = searchQuery.value.trim().toLowerCase();
  return artists.value.filter((artist) => artist.artist?.toLowerCase().includes(query));
});
const isAlbumDetail = computed(() => mode.value === 'albums' && selectedAlbum.value);
const selectedPlaylist = computed(
  () => playlists.value.find((playlist) => playlist.id === selectedPlaylistId.value) || null
);
const playlistTracks = computed(() => selectedPlaylist.value?.tracks || []);
const isPlaylistDetail = computed(() => mode.value === 'playlists' && selectedPlaylist.value);
const activePinPath = computed(() => activePin.value?.path || '');
const albumTrackCount = computed(() => {
  if (!selectedAlbum.value) {
    return 0;
  }
  const fromAlbum = Number(selectedAlbum.value.tracks);
  if (Number.isFinite(fromAlbum) && fromAlbum > 0) {
    return fromAlbum;
  }
  return albumTracks.value.length;
});

const hasMore = computed(() => {
  if (mode.value === 'songs') {
    return displaySongs.value.length < (isSearchMode.value ? searchTotal.value : total.value);
  }
  if (mode.value === 'albums') {
    if (selectedAlbum.value) {
      return false;
    }
    return albums.value.length < albumsTotal.value;
  }
  if (mode.value === 'playlists') {
    return false;
  }
  return artists.value.length < artistsTotal.value;
});

function formatDuration(value) {
  if (!value && value !== 0) {
    return '';
  }
  const totalSeconds = Math.round(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function trackTitle(item) {
  return item.title || item.name || 'Unknown Track';
}

function trackArtist(item) {
  return item.artist || 'Unknown Artist';
}

function trackAlbum(item) {
  return item.album || 'Unknown Album';
}

async function loadTracks({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  if (reset) {
    offset.value = 0;
    total.value = 0;
    items.value = [];
  }
  loading.value = true;
  error.value = '';
  try {
    const pageOffset = reset ? 0 : offset.value;
    const pathPrefix = activePinPath.value ? `&pathPrefix=${encodeURIComponent(activePinPath.value)}` : '';
    const res = await apiFetch(
      `/api/media?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&type=music&limit=${props.pageSize}&offset=${pageOffset}${pathPrefix}`
    );
    if (!res.ok) {
      error.value = 'Failed to load tracks';
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    items.value = reset ? newItems : [...items.value, ...newItems];
    total.value = data.total || 0;
    offset.value = pageOffset + newItems.length;
  } catch (err) {
    error.value = 'Failed to load tracks';
  } finally {
    loading.value = false;
  }
}

async function runSearch({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  if (mode.value !== 'songs') {
    return;
  }
  const query = searchQuery.value.trim();
  if (!query) {
    searchResults.value = [];
    searchOffset.value = 0;
    searchTotal.value = 0;
    return;
  }
  if (reset) {
    searchResults.value = [];
    searchOffset.value = 0;
    searchTotal.value = 0;
  }
  loading.value = true;
  try {
    const pageOffset = reset ? 0 : searchOffset.value;
    const pathPrefix = activePinPath.value ? `&pathPrefix=${encodeURIComponent(activePinPath.value)}` : '';
    const res = await apiFetch(
      `/api/search?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&type=music&q=${encodeURIComponent(query)}` +
        `&limit=${props.pageSize}&offset=${pageOffset}${pathPrefix}`
    );
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    searchResults.value = reset ? newItems : [...searchResults.value, ...newItems];
    searchTotal.value = data.total || 0;
    searchOffset.value = pageOffset + newItems.length;
  } catch (err) {
    searchResults.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadAlbums({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  if (reset) {
    albumsOffset.value = 0;
    albumsTotal.value = 0;
    albums.value = [];
  }
  loading.value = true;
  error.value = '';
  try {
    const pageOffset = reset ? 0 : albumsOffset.value;
    const pathPrefix = activePinPath.value ? `&pathPrefix=${encodeURIComponent(activePinPath.value)}` : '';
    const res = await apiFetch(
      `/api/music/albums?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&limit=${props.pageSize}&offset=${pageOffset}${pathPrefix}`
    );
    if (!res.ok) {
      error.value = 'Failed to load albums';
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    albums.value = reset ? newItems : [...albums.value, ...newItems];
    albumsTotal.value = data.total || 0;
    albumsOffset.value = pageOffset + newItems.length;
  } catch (err) {
    error.value = 'Failed to load albums';
  } finally {
    loading.value = false;
  }
}

async function loadArtists({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  if (reset) {
    artistsOffset.value = 0;
    artistsTotal.value = 0;
    artists.value = [];
  }
  loading.value = true;
  error.value = '';
  try {
    const pageOffset = reset ? 0 : artistsOffset.value;
    const pathPrefix = activePinPath.value ? `&pathPrefix=${encodeURIComponent(activePinPath.value)}` : '';
    const res = await apiFetch(
      `/api/music/artists?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&limit=${props.pageSize}&offset=${pageOffset}${pathPrefix}`
    );
    if (!res.ok) {
      error.value = 'Failed to load artists';
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    artists.value = reset ? newItems : [...artists.value, ...newItems];
    artistsTotal.value = data.total || 0;
    artistsOffset.value = pageOffset + newItems.length;
  } catch (err) {
    error.value = 'Failed to load artists';
  } finally {
    loading.value = false;
  }
}

async function loadAlbumTracks(key) {
  if (!props.currentRoot || !key) {
    return;
  }
  const pathPrefix = activePinPath.value ? `&pathPrefix=${encodeURIComponent(activePinPath.value)}` : '';
  const res = await apiFetch(
    `/api/music/album?root=${encodeURIComponent(props.currentRoot.id)}&key=${encodeURIComponent(key)}${pathPrefix}`
  );
  if (!res.ok) {
    return;
  }
  const data = await res.json();
  albumTracks.value = data.items || [];
}

async function loadArtistTracks(artist) {
  if (!props.currentRoot || !artist) {
    return;
  }
  const pathPrefix = activePinPath.value ? `&pathPrefix=${encodeURIComponent(activePinPath.value)}` : '';
  const res = await apiFetch(
    `/api/music/artist?root=${encodeURIComponent(props.currentRoot.id)}` +
      `&artist=${encodeURIComponent(artist)}${pathPrefix}`
  );
  if (!res.ok) {
    return;
  }
  const data = await res.json();
  artistTracks.value = data.items || [];
}

async function loadMore() {
  if (loading.value || !hasMore.value) {
    return;
  }
  if (mode.value === 'songs') {
    if (isSearchMode.value) {
      await runSearch({ reset: false });
    } else {
      await loadTracks({ reset: false });
    }
    return;
  }
  if (mode.value === 'albums') {
    if (selectedAlbum.value) {
      return;
    }
    await loadAlbums({ reset: false });
    return;
  }
  if (mode.value === 'playlists') {
    return;
  }
  await loadArtists({ reset: false });
}

async function selectTrack(item) {
  selectedTrack.value = item;
}

async function selectAlbum(album) {
  selectedAlbum.value = album;
  selectedArtist.value = null;
  await loadAlbumTracks(album.albumKey);
  props.onNavigate({ mode: 'albums', albumKey: album.albumKey, artist: null, playlistId: null });
}

function clearAlbumSelection() {
  selectedAlbum.value = null;
  albumTracks.value = [];
  props.onNavigate({ mode: 'albums', albumKey: null, artist: null, playlistId: null });
}

async function selectArtist(artist) {
  selectedArtist.value = artist;
  selectedAlbum.value = null;
  await loadArtistTracks(artist.artist);
  props.onNavigate({ mode: 'artists', artist: artist.artist, albumKey: null, playlistId: null });
}

function selectPlaylist(playlist) {
  selectedPlaylistId.value = playlist?.id || null;
  mode.value = 'playlists';
  searchQuery.value = '';
  props.onNavigate({
    mode: 'playlists',
    playlistId: selectedPlaylistId.value,
    albumKey: null,
    artist: null,
  });
}

function selectMode(value) {
  mode.value = value;
  searchQuery.value = '';
  selectedAlbum.value = null;
  selectedArtist.value = null;
  if (value !== 'playlists') {
    selectedPlaylistId.value = null;
  }
  albumTracks.value = [];
  artistTracks.value = [];
  props.onNavigate({ mode: value, albumKey: null, artist: null, playlistId: null });
  if (value === 'songs') {
    loadTracks({ reset: true });
  } else if (value === 'albums') {
    loadAlbums({ reset: true });
  } else if (value === 'playlists') {
    return;
  } else {
    loadArtists({ reset: true });
  }
}

async function applyNavState() {
  const nextMode = props.navState?.mode || 'songs';
  if (mode.value !== nextMode) {
    mode.value = nextMode;
  }
  if (nextMode === 'albums') {
    if (!albums.value.length) {
      await loadAlbums({ reset: true });
    }
    const key = props.navState?.albumKey;
    if (key) {
      const foundAlbum = albums.value.find((album) => album.albumKey === key);
      if (foundAlbum) {
        selectedAlbum.value = foundAlbum;
      } else if (selectedAlbum.value?.albumKey !== key) {
        selectedAlbum.value = { albumKey: key };
      }
      await loadAlbumTracks(key);
    } else {
      selectedAlbum.value = null;
      albumTracks.value = [];
    }
    return;
  }
  if (nextMode === 'artists') {
    if (!artists.value.length) {
      await loadArtists({ reset: true });
    }
    const artist = props.navState?.artist;
    if (artist) {
      selectedArtist.value = selectedArtist.value?.artist === artist ? selectedArtist.value : { artist };
      await loadArtistTracks(artist);
    } else {
      selectedArtist.value = null;
      artistTracks.value = [];
    }
    return;
  }
  if (nextMode === 'playlists') {
    const playlistId = props.navState?.playlistId || null;
    selectedPlaylistId.value = playlistId;
    if (playlistId && !playlists.value.find((playlist) => playlist.id === playlistId)) {
      selectedPlaylistId.value = null;
    }
    return;
  }
  if (!items.value.length) {
    await loadTracks({ reset: true });
  }
}

function closeContextMenu() {
  contextMenu.value = { open: false, x: 0, y: 0, track: null };
}

function openContextMenu(event, track) {
  contextMenu.value = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    track,
  };
}

function persistPlaylists() {
  localStorage.setItem('localCloudPlaylists', JSON.stringify(playlists.value));
  localStorage.setItem('localCloudPlaylistCounter', String(draftCounter.value));
}

function loadPlaylists() {
  try {
    const stored = localStorage.getItem('localCloudPlaylists');
    playlists.value = stored ? JSON.parse(stored) : [];
  } catch {
    playlists.value = [];
  }
  const counter = parseInt(localStorage.getItem('localCloudPlaylistCounter') || '1', 10);
  draftCounter.value = Number.isFinite(counter) && counter > 0 ? counter : 1;
}

function ensureDraftPlaylist() {
  let draft = playlists.value.find((playlist) => playlist.isDraft);
  if (!draft) {
    const id = `draft-${Date.now()}`;
    draft = {
      id,
      name: `New Playlist #${draftCounter.value}`,
      tracks: [],
      isDraft: true,
    };
    draftCounter.value += 1;
    playlists.value = [draft, ...playlists.value];
  }
  return draft;
}

function addTracksToPlaylist(tracksToAdd) {
  if (!Array.isArray(tracksToAdd) || !tracksToAdd.length) {
    return;
  }
  const draft = ensureDraftPlaylist();
  const existing = new Set(draft.tracks.map((track) => track.path));
  const added = [];
  for (const track of tracksToAdd) {
    if (!track?.path || existing.has(track.path)) {
      continue;
    }
    existing.add(track.path);
    added.push(track);
  }
  if (added.length) {
    draft.tracks = [...draft.tracks, ...added];
  }
  persistPlaylists();
}

function addTrackToPlaylist(track) {
  addTracksToPlaylist([track]);
  closeContextMenu();
}

function addAlbumToPlaylist() {
  if (!albumTracks.value.length) {
    return;
  }
  addTracksToPlaylist(albumTracks.value);
}

function savePlaylist() {
  if (!selectedPlaylist.value) {
    return;
  }
  selectedPlaylist.value.isDraft = false;
  persistPlaylists();
}

function clearPlaylist() {
  if (!selectedPlaylist.value) {
    return;
  }
  const removingId = selectedPlaylist.value.id;
  playlists.value = playlists.value.filter((playlist) => playlist.id !== removingId);
  if (selectedPlaylistId.value === removingId) {
    selectedPlaylistId.value = null;
  }
  props.onNavigate({ mode: 'playlists', playlistId: null, albumKey: null, artist: null });
  persistPlaylists();
}

function updatePlaylistName(value) {
  if (!selectedPlaylist.value) {
    return;
  }
  selectedPlaylist.value.name = value;
  persistPlaylists();
}

function persistPins() {
  localStorage.setItem('localCloudMusicPins', JSON.stringify(musicPins.value));
}

function loadPins() {
  try {
    const stored = localStorage.getItem('localCloudMusicPins');
    musicPins.value = stored ? JSON.parse(stored) : [];
  } catch {
    musicPins.value = [];
  }
}

function pinLabel(pathValue) {
  if (!pathValue) {
    return 'Root';
  }
  const parts = pathValue.split('/');
  return parts[parts.length - 1] || pathValue;
}

function addPinForTrack(track) {
  if (!track?.path) {
    return;
  }
  const parts = track.path.split('/');
  parts.pop();
  const pathValue = parts.join('/');
  if (musicPins.value.some((pin) => pin.path === pathValue)) {
    closeContextMenu();
    return;
  }
  const nextPin = {
    id: `pin-${Date.now()}`,
    path: pathValue,
    label: pinLabel(pathValue),
  };
  musicPins.value = [...musicPins.value, nextPin];
  persistPins();
  closeContextMenu();
}

function selectPin(pin) {
  activePin.value = pin;
}

function clearPin() {
  activePin.value = null;
}

let searchTimer = null;
watch(searchQuery, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch({ reset: true }), 250);
});

watch(activePin, () => {
  searchQuery.value = '';
  if (mode.value === 'songs') {
    loadTracks({ reset: true });
    return;
  }
  if (mode.value === 'albums') {
    if (selectedAlbum.value) {
      loadAlbumTracks(selectedAlbum.value.albumKey);
      return;
    }
    loadAlbums({ reset: true });
    return;
  }
  if (mode.value === 'artists') {
    if (selectedArtist.value) {
      loadArtistTracks(selectedArtist.value.artist);
      return;
    }
    loadArtists({ reset: true });
  }
});

watch(
  () => props.currentRoot,
  () => {
    searchQuery.value = '';
    selectedTrack.value = null;
    selectedAlbum.value = null;
    selectedArtist.value = null;
    selectedPlaylistId.value = null;
    albumTracks.value = [];
    artistTracks.value = [];
    applyNavState();
  },
  { immediate: true }
);

watch(
  () => props.navState,
  () => {
    applyNavState();
  },
  { deep: true }
);

watch(
  () => props.pageSize,
  () => {
    applyNavState();
  }
);

onMounted(() => {
  loadPlaylists();
  loadPins();
  applyNavState();
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMore();
    }
  });
  if (sentinel.value) {
    observer.observe(sentinel.value);
  }
  window.addEventListener('click', closeContextMenu);
  window.addEventListener('scroll', closeContextMenu, true);
});

onUnmounted(() => {
  window.removeEventListener('click', closeContextMenu);
  window.removeEventListener('scroll', closeContextMenu, true);
});

watch(sentinel, (value) => {
  if (!observer || !value) {
    return;
  }
  observer.observe(value);
});
</script>

<template>
  <section class="layout layout-wide music-layout">
    <aside class="sidebar">
      <h3>Music</h3>
      <div class="sidebar-section">
        <div class="sidebar-title">Library</div>
        <button class="sidebar-item" :class="{ active: mode === 'songs' }" @click="selectMode('songs')">
          <span class="icon"><i class="fa-solid fa-music"></i></span>
          Songs
        </button>
        <button class="sidebar-item" :class="{ active: mode === 'albums' }" @click="selectMode('albums')">
          <span class="icon"><i class="fa-solid fa-compact-disc"></i></span>
          Albums
        </button>
        <button class="sidebar-item" :class="{ active: mode === 'artists' }" @click="selectMode('artists')">
          <span class="icon"><i class="fa-solid fa-user"></i></span>
          Artists
        </button>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Playlists</div>
        <button
          class="sidebar-item"
          :class="{ active: mode === 'playlists' && !selectedPlaylistId }"
          @click="selectMode('playlists')"
        >
          <span class="icon"><i class="fa-solid fa-list"></i></span>
          Playlists
        </button>
        <button
          v-for="playlist in playlists"
          :key="playlist.id"
          class="sidebar-item"
          :class="{ active: selectedPlaylistId === playlist.id }"
          @click="selectPlaylist(playlist)"
        >
          <span class="icon"><i class="fa-solid fa-list-music"></i></span>
          <span class="sidebar-label">{{ playlist.name }}</span>
          <span class="sidebar-count">{{ playlist.tracks.length }}</span>
        </button>
        <div v-if="!playlists.length" class="sidebar-hint">Right-click a track to add.</div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Pinned</div>
        <button
          class="sidebar-item"
          :class="{ active: !activePin }"
          @click="clearPin"
        >
          <span class="icon"><i class="fa-regular fa-bookmark"></i></span>
          All locations
        </button>
        <button
          v-for="pin in musicPins"
          :key="pin.id"
          class="sidebar-item"
          :class="{ active: activePin?.id === pin.id }"
          @click="selectPin(pin)"
        >
          <span class="icon"><i class="fa-solid fa-location-dot"></i></span>
          <span class="sidebar-label">{{ pin.label }}</span>
        </button>
        <div v-if="!musicPins.length" class="sidebar-hint">Right-click a track to pin.</div>
      </div>
    </aside>

    <main class="browser music-browser">
      <div class="toolbar">
        <div class="toolbar-title">
          <div class="toolbar-line">
            <button v-if="isAlbumDetail" class="action-btn secondary" @click="clearAlbumSelection">
              <i class="fa-solid fa-arrow-left"></i>
              Back
            </button>
            <button
              v-if="isPlaylistDetail"
              class="action-btn secondary"
              @click="selectMode('playlists')"
            >
              <i class="fa-solid fa-arrow-left"></i>
              Back
            </button>
            <strong>
              {{
                mode === 'songs'
                  ? 'Music'
                  : mode === 'albums'
                  ? 'Albums'
                  : mode === 'artists'
                  ? 'Artists'
                  : 'Playlists'
              }}
            </strong>
            <span class="meta" v-if="mode === 'songs'">
              - {{ displaySongs.length }} of {{ isSearchMode ? searchTotal : total }}
            </span>
            <span class="meta" v-else-if="mode === 'albums' && !selectedAlbum">
              - {{ filteredAlbums.length }} of {{ albumsTotal }}
            </span>
            <span class="meta" v-else-if="mode === 'albums'">
              - {{ albumTrackCount }} tracks
            </span>
            <span class="meta" v-else-if="mode === 'playlists' && !selectedPlaylist">
              - {{ playlists.length }} playlists
            </span>
            <span class="meta" v-else-if="mode === 'playlists'">
              - {{ playlistTracks.length }} tracks
            </span>
            <span class="meta" v-else>
              - {{ filteredArtists.length }} of {{ artistsTotal }}
            </span>
          </div>
        </div>
        <div
          class="toolbar-actions"
          v-if="mode === 'songs' || (mode === 'albums' && !selectedAlbum) || mode === 'artists'"
        >
          <input
            class="search"
            type="search"
            :placeholder="mode === 'songs' ? 'Search songs, albums, artists' : mode === 'albums' ? 'Filter albums' : 'Filter artists'"
            v-model="searchQuery"
          />
        </div>
      </div>

      <div v-if="loading && !displaySongs.length && mode === 'songs'" class="empty-state">Loading tracks...</div>
      <div v-else-if="loading && mode !== 'songs'" class="empty-state">Loading library...</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else-if="mode === 'songs' && !displaySongs.length" class="empty-state">
        Add audio files to your storage root to build the library.
      </div>

      <div v-if="mode === 'songs' && displaySongs.length" class="music-list">
        <div class="music-header">
          <div>Song</div>
          <div>Album</div>
          <div>Artist</div>
          <div>Duration</div>
        </div>
        <button
          v-for="item in displaySongs"
          :key="item.path"
          class="music-row"
          :class="{ selected: selectedTrack?.path === item.path }"
          @click="selectTrack(item)"
          @contextmenu.prevent="openContextMenu($event, item)"
        >
          <div class="music-title">{{ trackTitle(item) }}</div>
          <div>{{ trackAlbum(item) }}</div>
          <div>{{ trackArtist(item) }}</div>
          <div>{{ formatDuration(item.duration) || '--' }}</div>
        </button>
      </div>

      <div v-if="mode === 'albums' && !selectedAlbum" class="album-grid">
        <button
          v-for="album in filteredAlbums"
          :key="album.albumKey"
          class="album-card"
          :class="{ selected: selectedAlbum?.albumKey === album.albumKey }"
          @click="selectAlbum(album)"
        >
          <div class="album-art">
            <img
              v-if="album.coverKey"
              :src="albumArtUrl(rootId, album.coverKey)"
              :alt="album.album"
            />
            <div v-else class="tile-fallback"><i class="fa-solid fa-compact-disc"></i></div>
          </div>
          <strong>{{ album.album }}</strong>
          <div class="meta">{{ album.artist }}</div>
          <div class="meta">{{ album.tracks }} tracks</div>
        </button>
      </div>

      <div v-if="mode === 'albums' && selectedAlbum" class="album-detail">
        <div class="album-detail-header">
          <div class="album-detail-art">
            <img
              v-if="selectedAlbum.coverKey"
              :src="albumArtUrl(rootId, selectedAlbum.coverKey)"
              :alt="selectedAlbum.album"
            />
            <div v-else class="tile-fallback"><i class="fa-solid fa-compact-disc"></i></div>
          </div>
          <div class="album-detail-info">
            <div class="album-detail-title">{{ selectedAlbum.album || 'Unknown Album' }}</div>
            <div class="meta">{{ selectedAlbum.artist || 'Unknown Artist' }}</div>
            <div v-if="selectedAlbum.releaseDate" class="meta">
              Released {{ selectedAlbum.releaseDate }}
            </div>
            <div class="meta">{{ albumTrackCount }} tracks</div>
          </div>
          <div class="album-detail-actions">
            <button class="action-btn secondary" @click="addAlbumToPlaylist">
              <i class="fa-solid fa-plus"></i>
              Add to playlist
            </button>
          </div>
        </div>
        <div class="album-tracks">
          <div class="music-header">
            <div>Song</div>
            <div>Album</div>
            <div>Artist</div>
            <div>Duration</div>
          </div>
          <button
            v-for="track in albumTracks"
            :key="track.path"
            class="music-row"
            :class="{ selected: selectedTrack?.path === track.path }"
            @click="selectTrack(track)"
            @contextmenu.prevent="openContextMenu($event, track)"
          >
            <div class="music-title">{{ trackTitle(track) }}</div>
            <div>{{ trackAlbum(track) }}</div>
            <div>{{ trackArtist(track) }}</div>
            <div>{{ formatDuration(track.duration) || '--' }}</div>
          </button>
        </div>
      </div>

      <div v-if="mode === 'playlists' && !selectedPlaylist" class="playlist-grid">
        <button
          v-for="playlist in playlists"
          :key="playlist.id"
          class="playlist-card"
          @click="selectPlaylist(playlist)"
        >
          <div class="playlist-card-title">{{ playlist.name }}</div>
          <div class="meta">{{ playlist.tracks.length }} tracks</div>
          <div class="meta" v-if="playlist.isDraft">Draft</div>
        </button>
        <div v-if="!playlists.length" class="empty-state">
          Right-click a track to start a playlist.
        </div>
      </div>

      <div v-if="mode === 'playlists' && selectedPlaylist" class="playlist-detail">
        <div class="playlist-detail-header">
          <input
            class="playlist-name-input"
            type="text"
            :value="selectedPlaylist.name"
            @input="updatePlaylistName($event.target.value)"
          />
          <div class="playlist-detail-actions">
            <button class="action-btn secondary" @click="savePlaylist">
              <i class="fa-solid fa-floppy-disk"></i>
              Save
            </button>
            <button class="action-btn secondary" @click="clearPlaylist">
              <i class="fa-solid fa-trash"></i>
              Clear
            </button>
          </div>
        </div>
        <div class="album-tracks">
          <div class="music-header">
            <div>Song</div>
            <div>Album</div>
            <div>Artist</div>
            <div>Duration</div>
          </div>
          <button
            v-for="track in playlistTracks"
            :key="track.path"
            class="music-row"
            :class="{ selected: selectedTrack?.path === track.path }"
            @click="selectTrack(track)"
            @contextmenu.prevent="openContextMenu($event, track)"
          >
            <div class="music-title">{{ trackTitle(track) }}</div>
            <div>{{ trackAlbum(track) }}</div>
            <div>{{ trackArtist(track) }}</div>
            <div>{{ formatDuration(track.duration) || '--' }}</div>
          </button>
        </div>
      </div>

      <div v-if="mode === 'artists'" class="artist-list">
        <button
          v-for="artist in filteredArtists"
          :key="artist.artist"
          class="artist-row"
          :class="{ selected: selectedArtist?.artist === artist.artist }"
          @click="selectArtist(artist)"
        >
          <div class="music-title">{{ artist.artist }}</div>
          <div class="meta">{{ artist.albums }} albums</div>
          <div class="meta">{{ artist.tracks }} tracks</div>
        </button>
      </div>

      <div v-if="mode === 'artists' && selectedArtist" class="album-tracks">
        <div class="music-header">
          <div>Song</div>
          <div>Album</div>
          <div>Artist</div>
          <div>Duration</div>
        </div>
        <button
          v-for="track in artistTracks"
          :key="track.path"
          class="music-row"
          :class="{ selected: selectedTrack?.path === track.path }"
          @click="selectTrack(track)"
          @contextmenu.prevent="openContextMenu($event, track)"
        >
          <div class="music-title">{{ trackTitle(track) }}</div>
          <div>{{ trackAlbum(track) }}</div>
          <div>{{ trackArtist(track) }}</div>
          <div>{{ formatDuration(track.duration) || '--' }}</div>
        </button>
      </div>

      <div v-if="hasMore" class="empty-state">
        <button class="action-btn secondary" @click="loadMore">Load more</button>
      </div>
      <div ref="sentinel" class="scroll-sentinel"></div>
    </main>

    <div
      v-if="contextMenu.open"
      class="context-menu"
      :style="{ top: `${contextMenu.y}px`, left: `${contextMenu.x}px` }"
    >
      <button class="context-menu-item" @click="addTrackToPlaylist(contextMenu.track)">
        <i class="fa-solid fa-plus"></i>
        Add to playlist
      </button>
      <button class="context-menu-item" @click="addPinForTrack(contextMenu.track)">
        <i class="fa-regular fa-bookmark"></i>
        Pin location
      </button>
    </div>

  </section>

  <MiniPlayer
    :tracks="queue"
    :selected-track="selectedTrack"
    :root-id="rootId"
    :auto-play="true"
    @select="selectTrack"
  />
</template>
