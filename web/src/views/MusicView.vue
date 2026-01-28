<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useApi } from '../composables/useApi';
import { useDownloads } from '../composables/useDownloads';
import { useInfiniteScroll } from '../composables/useInfiniteScroll';
import { useLibraryApi } from '../composables/useLibraryApi';
import { useMenu, useGlobalMenuClose } from '../composables/useMenu';
import { useSort } from '../composables/useSort';
import { useMultiSelect } from '../composables/useMultiSelect';
import { useSidebar } from '../composables/useSidebar';
import { useDebouncedWatch } from '../composables/useDebouncedWatch';
import MiniPlayer from '../components/MiniPlayer.vue';
import { formatDuration } from '../utils/formatting';
import { itemKey as buildItemKey } from '../utils/itemKey';
import { hasMoreFromTotalOrCursor, loadPaged } from '../utils/pagination';

const props = defineProps({
  roots: {
    type: Array,
    required: true,
  },
  currentRoot: {
    type: Object,
    default: null,
  },
  jumpTo: {
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
  onOpenInFiles: {
    type: Function,
    default: null,
  },
  onNavigate: {
    type: Function,
    required: true,
  },
});

const { albumArtUrl } = useApi();
const { listMedia, searchEntries, listAlbums, listArtists, listAlbumTracks, listArtistTracks } =
  useLibraryApi();
const { downloadGrouped } = useDownloads();
const { setSort, sortList, compareText } = useSort();

const mode = ref('songs');
const items = ref([]);
const total = ref(0);
const offset = ref(0);
const cursor = ref(null);
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
const searchCursor = ref(null);
const loading = ref(false);
const error = ref('');
const selectedTrack = ref(null);
const selectedAlbum = ref(null);
const selectedArtist = ref(null);
const playlists = ref([]);
const selectedPlaylistId = ref(null);
const draftCounter = ref(1);
const {
  menu: contextMenu,
  openMenu: openContextMenuBase,
  closeMenu: closeContextMenu,
} = useMenu({ track: null });
const {
  menu: albumMenu,
  openMenu: openAlbumMenuBase,
  closeMenu: closeAlbumMenu,
} = useMenu({ album: null });
const musicPins = ref([]);
const activePin = ref(null);
const albumTracks = ref([]);
const artistTracks = ref([]);
const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
useGlobalMenuClose([closeContextMenu, closeAlbumMenu]);

const rootId = computed(() => props.currentRoot?.id || '');
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const displaySongs = computed(() => (isSearchMode.value ? searchResults.value : items.value));
const queue = computed(() => {
  if (mode.value === 'songs') {
    return sortedSongs.value;
  }
  if (mode.value === 'albums') {
    return sortedAlbumTracks.value;
  }
  if (mode.value === 'playlists') {
    return sortedPlaylistTracks.value;
  }
  return sortedArtistTracks.value;
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
const {
  selectedKeys: selectedTrackKeys,
  clearSelection: clearTrackSelectionKeys,
  setSingleSelection: setSingleTrackSelectionKey,
  toggleSelection: toggleTrackSelectionKey,
  selectRange: selectTrackRangeKey,
  isSelected: isTrackSelected,
} = useMultiSelect({
  getItems: () => currentTrackList(),
  getKey: (item) => itemKey(item),
});
const selectionCount = computed(() => selectedTrackKeys.value.length);
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
    if (isSearchMode.value) {
      return hasMoreFromTotalOrCursor({
        itemsLength: displaySongs.value.length,
        total: searchTotal.value,
        cursor: searchCursor.value,
      });
    }
    return hasMoreFromTotalOrCursor({
      itemsLength: displaySongs.value.length,
      total: total.value,
      cursor: cursor.value,
    });
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

function trackTitle(item) {
  return item.title || item.name || 'Unknown Track';
}

function trackArtist(item) {
  return item.artist || 'Unknown Artist';
}

function trackAlbum(item) {
  return item.album || 'Unknown Album';
}

function itemKey(item) {
  return buildItemKey(item);
}

function isSelectedTrack(track) {
  return isTrackSelected(track);
}

function trackSortValue(item, key) {
  if (key === 'duration') {
    return Number(item?.duration) || 0;
  }
  if (key === 'album') {
    return trackAlbum(item);
  }
  if (key === 'artist') {
    return trackArtist(item);
  }
  return trackTitle(item);
}

const sortNumericKeys = ['duration'];
const sortTieBreak = (a, b) => compareText(trackTitle(a), trackTitle(b));

const sortedSongs = computed(() =>
  sortList(displaySongs.value, {
    getValue: trackSortValue,
    numericKeys: sortNumericKeys,
    tieBreak: sortTieBreak,
  })
);
const sortedAlbumTracks = computed(() =>
  sortList(albumTracks.value, {
    getValue: trackSortValue,
    numericKeys: sortNumericKeys,
    tieBreak: sortTieBreak,
  })
);
const sortedPlaylistTracks = computed(() =>
  sortList(playlistTracks.value, {
    getValue: trackSortValue,
    numericKeys: sortNumericKeys,
    tieBreak: sortTieBreak,
  })
);
const sortedArtistTracks = computed(() =>
  sortList(artistTracks.value, {
    getValue: trackSortValue,
    numericKeys: sortNumericKeys,
    tieBreak: sortTieBreak,
  })
);

function currentTrackList() {
  if (mode.value === 'songs') {
    return sortedSongs.value;
  }
  if (mode.value === 'albums' && selectedAlbum.value) {
    return sortedAlbumTracks.value;
  }
  if (mode.value === 'playlists' && selectedPlaylist.value) {
    return sortedPlaylistTracks.value;
  }
  if (mode.value === 'artists' && selectedArtist.value) {
    return sortedArtistTracks.value;
  }
  return [];
}

function findTrackByKey(key) {
  return currentTrackList().find((track) => itemKey(track) === key) || null;
}

function clearTrackSelection() {
  clearTrackSelectionKeys();
}

function setSingleTrackSelection(track) {
  if (!track) {
    return;
  }
  setSingleTrackSelectionKey(track);
  selectedTrack.value = track;
}

function toggleTrackSelection(track) {
  if (!track) {
    return;
  }
  const key = itemKey(track);
  const wasSelected = selectedTrackKeys.value.includes(key);
  toggleTrackSelectionKey(track);
  if (wasSelected && itemKey(selectedTrack.value) === key) {
    const fallbackKey = selectedTrackKeys.value[selectedTrackKeys.value.length - 1];
    selectedTrack.value = fallbackKey ? findTrackByKey(fallbackKey) : null;
    return;
  }
  if (!wasSelected) {
    selectedTrack.value = track;
  }
}

function selectTrackRange(track, additive) {
  if (!track) {
    return;
  }
  selectTrackRangeKey(track, { additive });
  selectedTrack.value = track;
}

function getSelectedTracks() {
  const list = currentTrackList();
  if (!list.length || !selectedTrackKeys.value.length) {
    return [];
  }
  const byKey = new Map(list.map((track) => [itemKey(track), track]));
  return selectedTrackKeys.value.map((key) => byKey.get(key)).filter(Boolean);
}

async function loadTracks({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  await loadPaged({
    reset,
    items,
    total,
    offset,
    cursor,
    loading,
    error,
    errorMessage: 'Failed to load tracks',
    onReset: clearTrackSelection,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      listMedia({
        rootId: props.currentRoot.id,
        type: 'music',
        limit: props.pageSize,
        offset: pageOffset,
        cursor: pageCursor,
        pathPrefix: activePinPath.value || undefined,
        includeTotal: false,
      }),
  });
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
    searchCursor.value = null;
    searchTotal.value = 0;
    return;
  }
  await loadPaged({
    reset,
    items: searchResults,
    total: searchTotal,
    offset: searchOffset,
    cursor: searchCursor,
    loading,
    onReset: clearTrackSelection,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      searchEntries({
        rootId: props.currentRoot.id,
        type: 'music',
        query,
        limit: props.pageSize,
        offset: pageOffset,
        cursor: pageCursor,
        pathPrefix: activePinPath.value || undefined,
        includeTotal: false,
      }),
  });
}

async function loadAlbums({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  await loadPaged({
    reset,
    items: albums,
    total: albumsTotal,
    offset: albumsOffset,
    loading,
    error,
    errorMessage: 'Failed to load albums',
    fetchPage: ({ offset: pageOffset }) =>
      listAlbums({
        rootId: props.currentRoot.id,
        limit: props.pageSize,
        offset: pageOffset,
        pathPrefix: activePinPath.value || undefined,
      }),
  });
}

async function loadArtists({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  await loadPaged({
    reset,
    items: artists,
    total: artistsTotal,
    offset: artistsOffset,
    loading,
    error,
    errorMessage: 'Failed to load artists',
    fetchPage: ({ offset: pageOffset }) =>
      listArtists({
        rootId: props.currentRoot.id,
        limit: props.pageSize,
        offset: pageOffset,
        pathPrefix: activePinPath.value || undefined,
      }),
  });
}

async function loadAlbumTracks(key) {
  if (!props.currentRoot || !key) {
    return;
  }
  const result = await listAlbumTracks({
    rootId: props.currentRoot.id,
    key,
    pathPrefix: activePinPath.value || undefined,
  });
  if (!result.ok) {
    return;
  }
  const data = result.data || {};
  albumTracks.value = data.items || [];
}

async function loadArtistTracks(artist) {
  if (!props.currentRoot || !artist) {
    return;
  }
  const result = await listArtistTracks({
    rootId: props.currentRoot.id,
    artist,
    pathPrefix: activePinPath.value || undefined,
  });
  if (!result.ok) {
    return;
  }
  const data = result.data || {};
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

const { sentinel } = useInfiniteScroll(loadMore);

function selectTrack(item) {
  if (!item) {
    return;
  }
  setSingleTrackSelection(item);
}

function handleTrackClick(item, event) {
  const hasMeta = event?.metaKey || event?.ctrlKey;
  const hasShift = event?.shiftKey;
  if (hasShift) {
    selectTrackRange(item, hasMeta);
    return;
  }
  if (hasMeta) {
    toggleTrackSelection(item);
    return;
  }
  setSingleTrackSelection(item);
}

async function selectAlbum(album) {
  clearTrackSelection();
  selectedAlbum.value = album;
  selectedArtist.value = null;
  await loadAlbumTracks(album.albumKey);
  props.onNavigate({ mode: 'albums', albumKey: album.albumKey, artist: null, playlistId: null });
}

function clearAlbumSelection() {
  clearTrackSelection();
  selectedAlbum.value = null;
  albumTracks.value = [];
  props.onNavigate({ mode: 'albums', albumKey: null, artist: null, playlistId: null });
}

async function selectArtist(artist) {
  clearTrackSelection();
  selectedArtist.value = artist;
  selectedAlbum.value = null;
  await loadArtistTracks(artist.artist);
  props.onNavigate({ mode: 'artists', artist: artist.artist, albumKey: null, playlistId: null });
}

function selectPlaylist(playlist) {
  clearTrackSelection();
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
  clearTrackSelection();
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
  clearTrackSelection();
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

function handleSelectMode(nextMode) {
  selectMode(nextMode);
  closeSidebar();
}

function handleSelectPlaylist(playlist) {
  selectPlaylist(playlist);
  closeSidebar();
}

function handlePinClear() {
  clearPin();
  closeSidebar();
}

function handlePinSelect(pin) {
  selectPin(pin);
  closeSidebar();
}

function openContextMenu(event, track) {
  closeAlbumMenu();
  if (!isSelectedTrack(track)) {
    setSingleTrackSelectionKey(track);
  }
  openContextMenuBase(event, { track });
}

function handleOpenInFiles(track) {
  if (!track?.path || !props.onOpenInFiles) {
    return;
  }
  const trackRoot = resolveTrackRootId(track);
  if (!trackRoot) {
    return;
  }
  const parts = track.path.split('/');
  parts.pop();
  const pathValue = parts.join('/');
  props.onOpenInFiles({ rootId: trackRoot, path: pathValue });
  closeContextMenu();
}

function openAlbumMenu(event, album) {
  closeContextMenu();
  openAlbumMenuBase(event, { album });
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

function addSelectionToPlaylist() {
  const tracks = getSelectedTracks();
  if (!tracks.length) {
    return;
  }
  addTracksToPlaylist(tracks);
  closeContextMenu();
}

function resolveTrackRootId(track) {
  if (track?.rootId) {
    return track.rootId;
  }
  if (rootId.value && rootId.value !== '__all__') {
    return rootId.value;
  }
  return '';
}

async function downloadTracks(tracks, options = {}) {
  await downloadGrouped({
    items: tracks,
    getRootId: resolveTrackRootId,
    getPath: (track) => track.path,
    getName: (track) => track.name || track.title || 'download',
    zipLabel: options.zipLabel || 'music',
    flatten: Boolean(options.flatten),
    includeRoot: options.includeRoot ?? true,
  });
}

async function handleDownloadSelection() {
  const tracks = selectionCount.value > 1 ? getSelectedTracks() : [contextMenu.value.track];
  const filtered = tracks.filter(Boolean);
  if (!filtered.length) {
    return;
  }
  await downloadTracks(filtered);
  closeContextMenu();
}

async function fetchAlbumTracksByKey(key) {
  if (!props.currentRoot || !key) {
    return [];
  }
  const result = await listAlbumTracks({
    rootId: props.currentRoot.id,
    key,
    pathPrefix: activePinPath.value || undefined,
  });
  if (!result.ok) {
    return [];
  }
  const data = result.data || {};
  return data.items || [];
}

async function handleDownloadAlbumTracks(album) {
  if (!album?.albumKey) {
    return;
  }
  const tracks = await fetchAlbumTracksByKey(album.albumKey);
  if (!tracks.length) {
    return;
  }
  await downloadTracks(tracks);
  closeAlbumMenu();
}

async function handleDownloadSelectedAlbum() {
  if (!albumTracks.value.length) {
    return;
  }
  await downloadTracks(albumTracks.value);
}

async function handleDownloadPlaylistTracks() {
  if (!playlistTracks.value.length) {
    return;
  }
  await downloadTracks(playlistTracks.value, {
    flatten: true,
    zipLabel: selectedPlaylist.value?.name || 'playlist',
    includeRoot: false,
  });
}

async function addAlbumToPlaylist(album) {
  if (album?.albumKey) {
    const tracks = await fetchAlbumTracksByKey(album.albumKey);
    if (!tracks.length) {
      return;
    }
    addTracksToPlaylist(tracks);
    closeAlbumMenu();
    return;
  }
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

useDebouncedWatch(searchQuery, () => runSearch({ reset: true }));

watch(activePin, () => {
  clearTrackSelection();
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
    clearTrackSelection();
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
  () => props.jumpTo,
  (value) => {
    if (!value || typeof value.path !== 'string') {
      return;
    }
    const parts = value.path.split('/');
    parts.pop();
    const pathValue = parts.join('/');
    if (pathValue) {
      activePin.value = { id: `jump-${value.token || Date.now()}`, path: pathValue, label: pinLabel(pathValue) };
    } else {
      activePin.value = null;
    }
  },
  { deep: true }
);

watch(
  () => props.pageSize,
  () => {
    applyNavState();
  }
);

watch(
  () => props.roots,
  () => {
    if (props.currentRoot?.id === '__all__') {
      applyNavState();
    }
  }
);

onMounted(() => {
  loadPlaylists();
  loadPins();
  applyNavState();
});
</script>

<template>
  <section class="layout layout-wide music-layout" :class="{ 'sidebar-open': sidebarOpen }">
    <aside class="sidebar">
      <h3>Music</h3>
      <div class="sidebar-section">
        <div class="sidebar-title">Library</div>
        <button class="sidebar-item" :class="{ active: mode === 'songs' }" @click="handleSelectMode('songs')">
          <span class="icon"><i class="fa-solid fa-music"></i></span>
          Songs
        </button>
        <button class="sidebar-item" :class="{ active: mode === 'albums' }" @click="handleSelectMode('albums')">
          <span class="icon"><i class="fa-solid fa-compact-disc"></i></span>
          Albums
        </button>
        <button class="sidebar-item" :class="{ active: mode === 'artists' }" @click="handleSelectMode('artists')">
          <span class="icon"><i class="fa-solid fa-user"></i></span>
          Artists
        </button>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Playlists</div>
        <button
          class="sidebar-item"
          :class="{ active: mode === 'playlists' && !selectedPlaylistId }"
          @click="handleSelectMode('playlists')"
        >
          <span class="icon"><i class="fa-solid fa-list"></i></span>
          Playlists
        </button>
        <button
          v-for="playlist in playlists"
          :key="playlist.id"
          class="sidebar-item"
          :class="{ active: selectedPlaylistId === playlist.id }"
          @click="handleSelectPlaylist(playlist)"
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
          @click="handlePinClear"
        >
          <span class="icon"><i class="fa-regular fa-bookmark"></i></span>
          All locations
        </button>
        <button
          v-for="pin in musicPins"
          :key="pin.id"
          class="sidebar-item"
          :class="{ active: activePin?.id === pin.id }"
          @click="handlePinSelect(pin)"
        >
          <span class="icon"><i class="fa-solid fa-location-dot"></i></span>
          <span class="sidebar-label">{{ pin.label }}</span>
        </button>
        <div v-if="!musicPins.length" class="sidebar-hint">Right-click a track to pin.</div>
      </div>
    </aside>
    <div class="sidebar-scrim" @click="closeSidebar"></div>

    <main class="browser music-browser">
      <div class="toolbar">
        <div class="toolbar-title">
          <div class="toolbar-line">
            <button class="icon-btn sidebar-toggle" @click="toggleSidebar" aria-label="Toggle sidebar">
              <i class="fa-solid fa-bars"></i>
            </button>
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
          <button class="music-sort" @click="setSort('title')">Song</button>
          <button class="music-sort" @click="setSort('album')">Album</button>
          <button class="music-sort" @click="setSort('artist')">Artist</button>
          <button class="music-sort" @click="setSort('duration')">Duration</button>
        </div>
        <button
          v-for="item in sortedSongs"
          :key="itemKey(item)"
          class="music-row"
          :class="{ selected: isSelectedTrack(item) }"
          @click="handleTrackClick(item, $event)"
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
          @contextmenu.prevent="openAlbumMenu($event, album)"
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
            <button
              class="action-btn secondary"
              @click="handleDownloadSelectedAlbum"
              :disabled="!albumTracks.length"
            >
              <i class="fa-solid fa-download"></i>
              Download album
            </button>
          </div>
        </div>
        <div class="album-tracks">
          <div class="music-header">
            <button class="music-sort" @click="setSort('title')">Song</button>
            <button class="music-sort" @click="setSort('album')">Album</button>
            <button class="music-sort" @click="setSort('artist')">Artist</button>
            <button class="music-sort" @click="setSort('duration')">Duration</button>
          </div>
          <button
          v-for="track in sortedAlbumTracks"
          :key="itemKey(track)"
          class="music-row"
          :class="{ selected: isSelectedTrack(track) }"
          @click="handleTrackClick(track, $event)"
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
            <button
              class="action-btn secondary"
              @click="handleDownloadPlaylistTracks"
              :disabled="!playlistTracks.length"
            >
              <i class="fa-solid fa-download"></i>
              Download playlist
            </button>
            <button class="action-btn secondary" @click="clearPlaylist">
              <i class="fa-solid fa-trash"></i>
              Clear
            </button>
          </div>
        </div>
        <div class="album-tracks">
          <div class="music-header">
            <button class="music-sort" @click="setSort('title')">Song</button>
            <button class="music-sort" @click="setSort('album')">Album</button>
            <button class="music-sort" @click="setSort('artist')">Artist</button>
            <button class="music-sort" @click="setSort('duration')">Duration</button>
          </div>
          <button
          v-for="track in sortedPlaylistTracks"
          :key="itemKey(track)"
          class="music-row"
          :class="{ selected: isSelectedTrack(track) }"
          @click="handleTrackClick(track, $event)"
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
          <button class="music-sort" @click="setSort('title')">Song</button>
          <button class="music-sort" @click="setSort('album')">Album</button>
          <button class="music-sort" @click="setSort('artist')">Artist</button>
          <button class="music-sort" @click="setSort('duration')">Duration</button>
        </div>
        <button
          v-for="track in sortedArtistTracks"
          :key="itemKey(track)"
          class="music-row"
          :class="{ selected: isSelectedTrack(track) }"
          @click="handleTrackClick(track, $event)"
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
      <button
        v-if="selectionCount > 1"
        class="context-menu-item"
        @click="addSelectionToPlaylist"
      >
        <i class="fa-solid fa-plus"></i>
        Add selection ({{ selectionCount }})
      </button>
      <button
        v-else
        class="context-menu-item"
        @click="addTrackToPlaylist(contextMenu.track)"
      >
        <i class="fa-solid fa-plus"></i>
        Add to playlist
      </button>
      <button class="context-menu-item" @click="addPinForTrack(contextMenu.track)">
        <i class="fa-regular fa-bookmark"></i>
        Pin location
      </button>
      <button class="context-menu-item" @click="handleOpenInFiles(contextMenu.track)">
        <i class="fa-solid fa-folder-open"></i>
        Open in Files
      </button>
      <button class="context-menu-item" @click="handleDownloadSelection">
        <i class="fa-solid fa-download"></i>
        {{ selectionCount > 1 ? `Download selection (${selectionCount})` : 'Download' }}
      </button>
    </div>

    <div
      v-if="albumMenu.open"
      class="context-menu"
      :style="{ top: `${albumMenu.y}px`, left: `${albumMenu.x}px` }"
    >
      <button class="context-menu-item" @click="addAlbumToPlaylist(albumMenu.album)">
        <i class="fa-solid fa-plus"></i>
        Add to playlist
      </button>
      <button class="context-menu-item" @click="handleDownloadAlbumTracks(albumMenu.album)">
        <i class="fa-solid fa-download"></i>
        Download album
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
