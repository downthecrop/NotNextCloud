<script setup>
import { ref, computed, watch, onMounted, nextTick } from 'vue';
import { useApi } from '../composables/useApi';

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
    default: () => ({ mode: 'songs', albumKey: null, artist: null }),
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
const albumArtOk = ref(true);
const albumTracks = ref([]);
const artistTracks = ref([]);
const audioRef = ref(null);
const currentTime = ref(0);
const duration = ref(0);
const isPlaying = ref(false);
const volume = ref(0.8);
const muted = ref(false);
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
  return artistTracks.value;
});
const currentIndex = computed(() => {
  if (!selectedTrack.value) {
    return -1;
  }
  return queue.value.findIndex((item) => item.path === selectedTrack.value.path);
});
const effectiveDuration = computed(() => {
  const fallback = selectedTrack.value?.duration || 0;
  const current = duration.value || 0;
  return current > 0 ? current : fallback;
});
const seekMax = computed(() =>
  Number.isFinite(effectiveDuration.value) && effectiveDuration.value > 0 ? effectiveDuration.value : 0
);
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

const hasMore = computed(() => {
  if (mode.value === 'songs') {
    return displaySongs.value.length < (isSearchMode.value ? searchTotal.value : total.value);
  }
  if (mode.value === 'albums') {
    return albums.value.length < albumsTotal.value;
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

function formatTime(value) {
  if (!value && value !== 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function togglePlay() {
  if (!audioRef.value) {
    return;
  }
  if (audioRef.value.paused) {
    audioRef.value.play().catch(() => {});
  } else {
    audioRef.value.pause();
  }
}

function playNext() {
  const list = queue.value;
  if (!list.length) {
    return;
  }
  if (currentIndex.value < 0) {
    selectTrack(list[0]);
    return;
  }
  const nextIndex = currentIndex.value + 1;
  if (nextIndex < list.length) {
    selectTrack(list[nextIndex]);
  }
}

function playPrev() {
  const list = queue.value;
  if (!list.length) {
    return;
  }
  if (currentTime.value > 3 && audioRef.value) {
    audioRef.value.currentTime = 0;
    return;
  }
  const prevIndex = currentIndex.value - 1;
  if (prevIndex >= 0) {
    selectTrack(list[prevIndex]);
    return;
  }
  if (audioRef.value) {
    audioRef.value.currentTime = 0;
  }
}

function onSeek(event) {
  if (!audioRef.value) {
    return;
  }
  const nextValue = parseFloat(event.target.value || '0');
  audioRef.value.currentTime = nextValue;
  currentTime.value = nextValue;
}

function onTimeUpdate() {
  if (!audioRef.value) {
    return;
  }
  currentTime.value = audioRef.value.currentTime || 0;
}

function onLoadedMetadata() {
  if (!audioRef.value) {
    return;
  }
  const nextDuration = audioRef.value.duration;
  duration.value = Number.isFinite(nextDuration) ? nextDuration : duration.value;
  audioRef.value.volume = volume.value;
  audioRef.value.muted = muted.value;
}

function onPlay() {
  isPlaying.value = true;
}

function onPause() {
  isPlaying.value = false;
}

function onEnded() {
  isPlaying.value = false;
  playNext();
}

function onDurationChange() {
  if (!audioRef.value) {
    return;
  }
  const nextDuration = audioRef.value.duration;
  duration.value = Number.isFinite(nextDuration) ? nextDuration : duration.value;
}

function onVolumeInput(event) {
  const nextValue = parseFloat(event.target.value || '0');
  volume.value = nextValue;
  if (audioRef.value) {
    audioRef.value.volume = nextValue;
  }
  if (nextValue > 0 && muted.value) {
    muted.value = false;
    if (audioRef.value) {
      audioRef.value.muted = false;
    }
  }
}

function toggleMute() {
  muted.value = !muted.value;
  if (audioRef.value) {
    audioRef.value.muted = muted.value;
  }
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
    const res = await apiFetch(
      `/api/media?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&type=music&limit=${props.pageSize}&offset=${pageOffset}`
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
    const res = await apiFetch(
      `/api/search?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&type=music&q=${encodeURIComponent(query)}` +
        `&limit=${props.pageSize}&offset=${pageOffset}`
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
    const res = await apiFetch(
      `/api/music/albums?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&limit=${props.pageSize}&offset=${pageOffset}`
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
    const res = await apiFetch(
      `/api/music/artists?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&limit=${props.pageSize}&offset=${pageOffset}`
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
  const res = await apiFetch(
    `/api/music/album?root=${encodeURIComponent(props.currentRoot.id)}&key=${encodeURIComponent(key)}`
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
  const res = await apiFetch(
    `/api/music/artist?root=${encodeURIComponent(props.currentRoot.id)}` +
      `&artist=${encodeURIComponent(artist)}`
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
    await loadAlbums({ reset: false });
    return;
  }
  await loadArtists({ reset: false });
}

async function selectTrack(item) {
  selectedTrack.value = item;
  currentTime.value = 0;
  duration.value = item?.duration || 0;
  await nextTick();
  if (audioRef.value) {
    audioRef.value.volume = volume.value;
    audioRef.value.muted = muted.value;
    audioRef.value.play().catch(() => {});
  }
}

async function selectAlbum(album) {
  selectedAlbum.value = album;
  selectedArtist.value = null;
  await loadAlbumTracks(album.albumKey);
  props.onNavigate({ mode: 'albums', albumKey: album.albumKey, artist: null });
}

async function selectArtist(artist) {
  selectedArtist.value = artist;
  selectedAlbum.value = null;
  await loadArtistTracks(artist.artist);
  props.onNavigate({ mode: 'artists', artist: artist.artist, albumKey: null });
}

function selectMode(value) {
  mode.value = value;
  searchQuery.value = '';
  selectedAlbum.value = null;
  selectedArtist.value = null;
  albumTracks.value = [];
  artistTracks.value = [];
  props.onNavigate({ mode: value, albumKey: null, artist: null });
  if (value === 'songs') {
    loadTracks({ reset: true });
  } else if (value === 'albums') {
    loadAlbums({ reset: true });
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
      selectedAlbum.value = selectedAlbum.value?.albumKey === key ? selectedAlbum.value : { albumKey: key };
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
  if (!items.value.length) {
    await loadTracks({ reset: true });
  }
}

let searchTimer = null;
watch(searchQuery, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch({ reset: true }), 250);
});

watch(
  () => props.currentRoot,
  () => {
    searchQuery.value = '';
    selectedTrack.value = null;
    selectedAlbum.value = null;
    selectedArtist.value = null;
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

watch(selectedTrack, (value) => {
  if (value?.duration && (!duration.value || duration.value < 0.5)) {
    duration.value = value.duration;
  }
  albumArtOk.value = Boolean(value?.albumKey);
});

watch(
  () => props.pageSize,
  () => {
    applyNavState();
  }
);

onMounted(() => {
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMore();
    }
  });
  if (sentinel.value) {
    observer.observe(sentinel.value);
  }
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
        <button class="sidebar-item placeholder" disabled>
          <span class="icon"><i class="fa-solid fa-plus"></i></span>
          Playlist +
        </button>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Pinned</div>
        <button class="sidebar-item placeholder" disabled>
          <span class="icon"><i class="fa-regular fa-bookmark"></i></span>
          Pin a location
        </button>
      </div>
    </aside>

    <main class="browser music-browser">
      <div class="toolbar">
        <div>
          <strong>Music</strong>
          <span class="meta" v-if="mode === 'songs'"> - {{ displaySongs.length }} of {{ isSearchMode ? searchTotal : total }}</span>
          <span class="meta" v-else-if="mode === 'albums'"> - {{ filteredAlbums.length }} of {{ albumsTotal }}</span>
          <span class="meta" v-else> - {{ filteredArtists.length }} of {{ artistsTotal }}</span>
        </div>
        <div class="toolbar-actions">
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
        >
          <div class="music-title">{{ trackTitle(item) }}</div>
          <div>{{ trackAlbum(item) }}</div>
          <div>{{ trackArtist(item) }}</div>
          <div>{{ formatDuration(item.duration) || '--' }}</div>
        </button>
      </div>

      <div v-if="mode === 'albums'" class="album-grid">
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

      <div v-if="mode === 'albums' && selectedAlbum" class="album-tracks">
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
        >
          <div class="music-title">{{ trackTitle(track) }}</div>
          <div>{{ trackAlbum(track) }}</div>
          <div>{{ trackArtist(track) }}</div>
          <div>{{ formatDuration(track.duration) || '--' }}</div>
        </button>
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

    <audio
      ref="audioRef"
      :src="selectedTrack ? fileUrl(rootId, selectedTrack.path) : ''"
      preload="metadata"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="onDurationChange"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
    ></audio>
  </section>

  <div class="player-bar">
    <div class="player-bar-left">
      <div class="player-bar-art">
        <img
          v-if="selectedTrack?.albumKey && albumArtOk"
          :src="albumArtUrl(rootId, selectedTrack.albumKey)"
          :alt="trackAlbum(selectedTrack)"
          @error="albumArtOk = false"
        />
        <div v-else class="tile-fallback"><i class="fa-solid fa-compact-disc"></i></div>
      </div>
      <div class="player-bar-info">
        <div class="player-bar-title">
          {{ selectedTrack ? trackTitle(selectedTrack) : 'Nothing playing' }}
        </div>
        <div class="meta" v-if="selectedTrack">
          {{ trackAlbum(selectedTrack) }}
        </div>
        <div class="meta" v-if="selectedTrack">
          {{ trackArtist(selectedTrack) }}
        </div>
      </div>
    </div>
    <div class="player-bar-middle">
      <div class="player-bar-seek">
        <span>{{ formatTime(currentTime) }}</span>
        <input
          type="range"
          min="0"
          :max="seekMax"
          step="0.1"
          :value="currentTime"
          @input="onSeek"
          :disabled="!selectedTrack || !seekMax"
        />
        <span>{{ formatTime(effectiveDuration) }}</span>
      </div>
    </div>
    <div class="player-bar-right">
      <div class="player-bar-buttons">
        <button class="icon-btn" @click="playPrev" :disabled="!selectedTrack" aria-label="Previous">
          <i class="fa-solid fa-backward-step"></i>
        </button>
        <button class="icon-btn" @click="togglePlay" :disabled="!selectedTrack" aria-label="Play/pause">
          <i :class="isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>
        </button>
        <button class="icon-btn" @click="playNext" :disabled="!selectedTrack" aria-label="Next">
          <i class="fa-solid fa-forward-step"></i>
        </button>
      </div>
      <div class="player-bar-volume">
        <button class="icon-btn" @click="toggleMute" :disabled="!selectedTrack" aria-label="Mute">
          <i :class="muted || volume === 0 ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'"></i>
        </button>
        <input
          class="volume-slider"
          type="range"
          min="0"
          max="1"
          step="0.01"
          :value="volume"
          @input="onVolumeInput"
          :disabled="!selectedTrack"
          aria-label="Volume"
        />
      </div>
    </div>
  </div>
</template>
