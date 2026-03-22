<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useApi } from '../composables/useApi';
import { useDownloads } from '../composables/useDownloads';
import { useInfiniteScroll } from '../composables/useInfiniteScroll';
import { useLibraryApi } from '../composables/useLibraryApi';
import { useMenu, useGlobalMenuClose } from '../composables/useMenu';
import { useSort } from '../composables/useSort';
import { useMultiSelect } from '../composables/useMultiSelect';
import { useSidebar } from '../composables/useSidebar';
import { useDebouncedWatch } from '../composables/useDebouncedWatch';
import { useDraftCollection } from '../composables/useDraftCollection';
import { usePinnedLocations } from '../composables/usePinnedLocations';
import AppSidebar from '../components/AppSidebar.vue';
import MiniPlayer from '../components/MiniPlayer.vue';
import SidebarNavItem from '../components/SidebarNavItem.vue';
import SidebarSection from '../components/SidebarSection.vue';
import ViewScrollArea from '../components/ViewScrollArea.vue';
import ViewToolbar from '../components/ViewToolbar.vue';
import { formatDuration } from '../utils/formatting';
import { itemKey as buildItemKey } from '../utils/itemKey';
import { hasMoreFromTotalOrCursor, loadPaged, resetPagedState } from '../utils/pagination';
import { parentPath } from '../utils/pathing';
import { ALL_ROOTS_ID } from '../constants';

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
  onTitleChange: {
    type: Function,
    default: null,
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
const requestVersion = ref(0);
let searchAbortController = null;
const selectedTrack = ref(null);
const selectedAlbum = ref(null);
const selectedArtist = ref(null);
const {
  entries: playlists,
  loadEntries: loadPlaylists,
  persistEntries: persistPlaylists,
  ensureDraftEntry: ensureDraftPlaylist,
  removeEntry: removePlaylistEntry,
} = useDraftCollection({
  storageKey: 'localCloudPlaylists',
  counterKey: 'localCloudPlaylistCounter',
  itemField: 'tracks',
  idPrefix: 'draft',
  namePrefix: 'New Playlist',
});
const selectedPlaylistId = ref(null);
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
const {
  menu: sidebarMenu,
  openMenu: openSidebarMenuBase,
  closeMenu: closeSidebarMenu,
} = useMenu({ kind: '', playlist: null, pin: null });
const albumTracks = ref([]);
const artistTracks = ref([]);
const musicScrollArea = ref(null);
const musicBrowserShell = ref(null);
const artistListScroll = ref({ containerY: 0 });
const artistAlbumCoverErrors = ref(new Set());
const albumOpenedFromArtist = ref(false);
const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
useGlobalMenuClose([closeContextMenu, closeAlbumMenu, closeSidebarMenu]);
const {
  pins: musicPins,
  activePin,
  activePinPath,
  loadPins,
  addPinForItemPath,
  setActivePinFromPath,
  selectPin,
  removePin,
  clearPin,
} = usePinnedLocations({ storageKey: 'localCloudMusicPins' });

const rootId = computed(() => props.currentRoot?.id || '');
const musicBrowserRef = computed(() => musicScrollArea.value?.scrollEl || null);
const viewportWidth = ref(typeof window !== 'undefined' ? window.innerWidth : 0);
const musicBrowserFrame = ref({ left: 0, width: 0, bottomInset: 0 });
const isCompactPlayer = computed(() => viewportWidth.value < 700);
const musicPlayerOverlayStyle = computed(() => {
  const bottom = `${Math.max(0, Math.round(musicBrowserFrame.value.bottomInset)) + 16}px`;
  if (isCompactPlayer.value && musicBrowserFrame.value.width > 0) {
    return {
      left: `${Math.round(musicBrowserFrame.value.left)}px`,
      width: `${Math.round(musicBrowserFrame.value.width)}px`,
      right: 'auto',
      transform: 'none',
      bottom,
    };
  }
  return {
    left: '0',
    right: '0',
    width: 'auto',
    transform: 'none',
    bottom,
  };
});
const activeLibraryPathPrefix = computed(() =>
  activePin.value?.kind === 'path' || (!activePin.value?.albumKey && activePinPath.value)
    ? activePinPath.value || ''
    : ''
);
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const albumSearchQuery = computed(() =>
  mode.value === 'albums' && !selectedAlbum.value ? searchQuery.value.trim() : ''
);
const artistSearchQuery = computed(() =>
  mode.value === 'artists' && !selectedArtist.value ? searchQuery.value.trim() : ''
);
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
const filteredAlbums = computed(() => albums.value);
const filteredArtists = computed(() => artists.value);
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
const isArtistDetail = computed(() => mode.value === 'artists' && selectedArtist.value);
const selectedPlaylist = computed(
  () => playlists.value.find((playlist) => playlist.id === selectedPlaylistId.value) || null
);
const playlistTracks = computed(() => selectedPlaylist.value?.tracks || []);
const isPlaylistDetail = computed(() => mode.value === 'playlists' && selectedPlaylist.value);
const albumTrackCount = computed(() => {
  if (!selectedAlbum.value) {
    return 0;
  }
  const fromAlbum = Number(selectedAlbum.value.tracks);
  if (Number.isFinite(fromAlbum) && fromAlbum > 0) {
    return Math.max(fromAlbum, albumTracks.value.length);
  }
  return albumTracks.value.length;
});
const selectedAlbumTitle = computed(() => {
  if (selectedAlbum.value?.album) {
    return selectedAlbum.value.album;
  }
  return albumTracks.value[0]?.album || 'Unknown Album';
});
const selectedAlbumArtist = computed(() => {
  if (selectedAlbum.value?.artist) {
    return selectedAlbum.value.artist;
  }
  return albumTracks.value[0]?.artist || 'Unknown Artist';
});
const selectedArtistAlbums = computed(() => {
  if (!isArtistDetail.value) {
    return [];
  }
  const byAlbum = new Map();
  for (const track of artistTracks.value) {
    const albumName = trackAlbum(track);
    const key = track?.albumKey || albumName.toLowerCase();
    const existing = byAlbum.get(key);
    if (existing) {
      existing.tracks += 1;
      existing.latest = Math.max(existing.latest, Number(track?.mtime) || 0);
      continue;
    }
    byAlbum.set(key, {
      key,
      albumKey: track?.albumKey || key,
      album: albumName,
      artist: selectedArtist.value?.artist || trackArtist(track),
      coverKey: track?.albumKey || null,
      tracks: 1,
      latest: Number(track?.mtime) || 0,
    });
  }
  return Array.from(byAlbum.values()).sort(
    (a, b) => b.latest - a.latest || compareText(a.album, b.album)
  );
});
const selectedArtistAlbumCount = computed(() => selectedArtistAlbums.value.length);
const selectedArtistTrackCount = computed(() => artistTracks.value.length);
let musicBrowserObserver = null;

function updateMusicPlayerOverlayMetrics() {
  viewportWidth.value = typeof window !== 'undefined' ? window.innerWidth : viewportWidth.value;
  const rect = musicBrowserShell.value?.getBoundingClientRect();
  if (!rect) {
    musicBrowserFrame.value = { left: 0, width: 0, bottomInset: 0 };
    return;
  }
  musicBrowserFrame.value = {
    left: rect.left,
    width: rect.width,
    bottomInset: Math.max(window.innerHeight - rect.bottom, 0),
  };
}

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
  if (mode.value === 'artists' && selectedArtist.value) {
    return false;
  }
  return artists.value.length < artistsTotal.value;
});
const songsMeta = computed(() => {
  const totalValue = isSearchMode.value ? searchTotal.value : total.value;
  if (Number.isFinite(totalValue) && totalValue >= 0) {
    return `${displaySongs.value.length} of ${totalValue}`;
  }
  return `${displaySongs.value.length}`;
});

function navigateMusic(nextState) {
  props.onNavigate({
    mode: mode.value,
    albumKey: null,
    artist: null,
    playlistId: null,
    ...nextState,
  });
}
const browserTitle = computed(() => {
  if (selectedTrack.value) {
    return `Now Playing: ${trackTitle(selectedTrack.value)} - ${trackArtist(selectedTrack.value)} · Local Cloud`;
  }
  if (mode.value === 'albums') {
    return selectedAlbum.value
      ? `${selectedAlbumTitle.value} · Albums · Local Cloud`
      : 'Albums · Local Cloud';
  }
  if (mode.value === 'artists') {
    return selectedArtist.value?.artist
      ? `${selectedArtist.value.artist} · Artists · Local Cloud`
      : 'Artists · Local Cloud';
  }
  if (mode.value === 'playlists') {
    return selectedPlaylist.value?.name
      ? `${selectedPlaylist.value.name} · Playlists · Local Cloud`
      : 'Playlists · Local Cloud';
  }
  return 'Music · Local Cloud';
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
const sortTracks = (list) =>
  sortList(list, {
    getValue: trackSortValue,
    numericKeys: sortNumericKeys,
    tieBreak: sortTieBreak,
  });

const sortedSongs = computed(() => sortTracks(displaySongs.value));
const sortedAlbumTracks = computed(() => sortTracks(albumTracks.value));
const sortedPlaylistTracks = computed(() => sortTracks(playlistTracks.value));
const sortedArtistTracks = computed(() => sortTracks(artistTracks.value));

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
    requestVersion,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      listMedia({
        rootId: props.currentRoot.id,
        type: 'music',
        limit: props.pageSize,
        offset: pageOffset,
        cursor: pageCursor,
        pathPrefix: activeLibraryPathPrefix.value || undefined,
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
  if (searchAbortController) {
    searchAbortController.abort();
    searchAbortController = null;
  }
  if (!query) {
    resetPagedState({ items: searchResults, total: searchTotal, offset: searchOffset, cursor: searchCursor });
    return;
  }
  const signal =
    typeof AbortController === 'undefined'
      ? null
      : (() => {
          searchAbortController = new AbortController();
          return searchAbortController.signal;
        })();
  await loadPaged({
    reset,
    items: searchResults,
    total: searchTotal,
    offset: searchOffset,
    cursor: searchCursor,
    loading,
    onReset: clearTrackSelection,
    requestVersion,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      searchEntries({
        rootId: props.currentRoot.id,
        type: 'music',
        query,
        limit: props.pageSize,
        offset: pageOffset,
        cursor: pageCursor,
        pathPrefix: activeLibraryPathPrefix.value || undefined,
        includeTotal: false,
        signal,
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
    requestVersion,
    fetchPage: ({ offset: pageOffset }) =>
      listAlbums({
        rootId: props.currentRoot.id,
        limit: props.pageSize,
        offset: pageOffset,
        pathPrefix: activeLibraryPathPrefix.value || undefined,
        query: albumSearchQuery.value || undefined,
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
    requestVersion,
    fetchPage: ({ offset: pageOffset }) =>
      listArtists({
        rootId: props.currentRoot.id,
        limit: props.pageSize,
        offset: pageOffset,
        pathPrefix: activeLibraryPathPrefix.value || undefined,
        query: artistSearchQuery.value || undefined,
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
    pathPrefix: activeLibraryPathPrefix.value || undefined,
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
    pathPrefix: activeLibraryPathPrefix.value || undefined,
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

const { sentinel } = useInfiniteScroll(loadMore, {
  canLoadMore: () => !loading.value && hasMore.value,
  rootRef: musicBrowserRef,
});

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

async function selectAlbum(album, { fromArtist = false } = {}) {
  clearTrackSelection();
  albumOpenedFromArtist.value = Boolean(fromArtist);
  selectedAlbum.value = album;
  if (!fromArtist) {
    selectedArtist.value = null;
    artistTracks.value = [];
  }
  await loadAlbumTracks(album.albumKey);
  navigateMusic({
    mode: 'albums',
    albumKey: album.albumKey,
    artist: fromArtist ? selectedArtist.value?.artist || null : null,
  });
}

function clearAlbumSelection() {
  clearTrackSelection();
  const returnToArtist = albumOpenedFromArtist.value && selectedArtist.value?.artist;
  const artistName = selectedArtist.value?.artist || null;
  selectedAlbum.value = null;
  albumTracks.value = [];
  albumOpenedFromArtist.value = false;
  if (returnToArtist) {
    mode.value = 'artists';
    navigateMusic({ mode: 'artists', artist: artistName });
    return;
  }
  navigateMusic({ mode: 'albums' });
}

async function selectArtist(artist) {
  artistListScroll.value = {
    containerY: musicBrowserRef.value?.scrollTop || 0,
  };
  clearTrackSelection();
  selectedArtist.value = artist;
  selectedAlbum.value = null;
  await loadArtistTracks(artist.artist);
  navigateMusic({ mode: 'artists', artist: artist.artist });
}

async function clearArtistSelection({ restoreScroll = true } = {}) {
  clearTrackSelection();
  selectedArtist.value = null;
  artistTracks.value = [];
  navigateMusic({ mode: 'artists' });
  if (!restoreScroll) {
    return;
  }
  await nextTick();
  if (musicBrowserRef.value) {
    musicBrowserRef.value.scrollTop = artistListScroll.value.containerY || 0;
  }
}

function selectPlaylist(playlist) {
  clearTrackSelection();
  selectedPlaylistId.value = playlist?.id || null;
  mode.value = 'playlists';
  searchQuery.value = '';
  navigateMusic({
    mode: 'playlists',
    playlistId: selectedPlaylistId.value,
  });
}

function selectMode(value) {
  clearTrackSelection();
  mode.value = value;
  searchQuery.value = '';
  selectedAlbum.value = null;
  albumOpenedFromArtist.value = false;
  selectedArtist.value = null;
  if (value !== 'playlists') {
    selectedPlaylistId.value = null;
  }
  albumTracks.value = [];
  artistTracks.value = [];
  navigateMusic({ mode: value });
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

function artistAlbumCoverKey(album) {
  return album?.key || album?.albumKey || album?.album || '';
}

function hasArtistAlbumCoverError(album) {
  return artistAlbumCoverErrors.value.has(artistAlbumCoverKey(album));
}

function markArtistAlbumCoverError(album) {
  const key = artistAlbumCoverKey(album);
  if (!key) {
    return;
  }
  artistAlbumCoverErrors.value = new Set([...artistAlbumCoverErrors.value, key]);
}

async function openPinnedAlbum(pin) {
  if (!pin?.albumKey) {
    return;
  }
  if (!albums.value.length) {
    await loadAlbums({ reset: true });
  }
  const foundAlbum =
    albums.value.find((album) => album.albumKey === pin.albumKey) || {
      albumKey: pin.albumKey,
      album: pin.label || 'Album',
      artist: pin.artist || 'Unknown Artist',
    };
  await selectAlbum(foundAlbum);
}

async function handlePinSelect(pin) {
  if (!pin) {
    closeSidebar();
    return;
  }
  selectPin(pin);
  if (pin.albumKey) {
    searchQuery.value = '';
    clearTrackSelection();
    await openPinnedAlbum(pin);
    closeSidebar();
    return;
  }
  searchQuery.value = '';
  navigateMusic({ mode: 'songs' });
  closeSidebar();
}

function openSidebarPlaylistMenu(event, playlist) {
  closeContextMenu();
  closeAlbumMenu();
  openSidebarMenuBase(event, { kind: 'playlist', playlist, pin: null });
}

function openSidebarPinMenu(event, pin) {
  closeContextMenu();
  closeAlbumMenu();
  openSidebarMenuBase(event, { kind: 'pin', pin, playlist: null });
}

function removeSidebarPlaylist(playlist) {
  if (!playlist?.id) {
    return;
  }
  const removingId = playlist.id;
  removePlaylistEntry(removingId);
  if (selectedPlaylistId.value === removingId) {
    selectedPlaylistId.value = null;
    if (mode.value === 'playlists') {
      navigateMusic({ mode: 'playlists' });
    }
  }
  persistPlaylists();
  closeSidebarMenu();
}

function removeQuickAccess(pin) {
  if (!pin?.id) {
    return;
  }
  removePin(pin.id);
  closeSidebarMenu();
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
  const pathValue = parentPath(track.path);
  props.onOpenInFiles({ rootId: trackRoot, path: pathValue });
  closeContextMenu();
}

function openAlbumMenu(event, album) {
  closeContextMenu();
  openAlbumMenuBase(event, { album });
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
  if (rootId.value && rootId.value !== ALL_ROOTS_ID) {
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
    pathPrefix: activeLibraryPathPrefix.value || undefined,
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
  removePlaylistEntry(removingId);
  if (selectedPlaylistId.value === removingId) {
    selectedPlaylistId.value = null;
  }
  navigateMusic({ mode: 'playlists' });
  persistPlaylists();
}

function updatePlaylistName(value) {
  if (!selectedPlaylist.value) {
    return;
  }
  selectedPlaylist.value.name = value;
  persistPlaylists();
}

function addPinForTrack(track) {
  if (!track?.path) {
    return;
  }
  const trackRootId = resolveTrackRootId(track);
  if (track.albumKey) {
    addPinForItemPath(track.path, {
      rootId: trackRootId,
      label: trackAlbum(track),
      meta: {
        kind: 'album',
        albumKey: track.albumKey,
        artist: trackArtist(track),
      },
    });
  } else {
    addPinForItemPath(track.path, {
      rootId: trackRootId,
      meta: { kind: 'path' },
    });
  }
  closeContextMenu();
}

function addPinForAlbum(album) {
  if (!album?.albumKey) {
    return;
  }
  const albumRootId =
    props.currentRoot?.id && props.currentRoot.id !== ALL_ROOTS_ID ? props.currentRoot.id : rootId.value;
  addPinForItemPath(`${album.albumKey}/track`, {
    rootId: albumRootId || '',
    label: album.album || 'Album',
    meta: {
      kind: 'album',
      albumKey: album.albumKey,
      artist: album.artist || 'Unknown Artist',
      coverKey: album.coverKey || null,
    },
  });
  closeAlbumMenu();
}

useDebouncedWatch(searchQuery, () => {
  if (mode.value === 'songs') {
    runSearch({ reset: true });
    return;
  }
  if (mode.value === 'albums' && !selectedAlbum.value) {
    loadAlbums({ reset: true });
    return;
  }
  if (mode.value === 'artists' && !selectedArtist.value) {
    loadArtists({ reset: true });
  }
});

watch(activeLibraryPathPrefix, () => {
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
  browserTitle,
  (value) => {
    props.onTitleChange?.(value);
  },
  { immediate: true }
);

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
  () => selectedArtist.value?.artist,
  () => {
    artistAlbumCoverErrors.value = new Set();
  }
);

watch(
  () => props.jumpTo,
  (value) => {
    if (!value || typeof value.path !== 'string') {
      return;
    }
    const pathValue = parentPath(value.path);
    if (pathValue) {
      setActivePinFromPath(pathValue, {
        idPrefix: 'jump',
        token: value.token || Date.now(),
      });
    } else {
      clearPin();
    }
  },
  { deep: true, immediate: true }
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
    if (props.currentRoot?.id === ALL_ROOTS_ID) {
      applyNavState();
    }
  }
);

onMounted(() => {
  loadPlaylists();
  loadPins();
  applyNavState();
  nextTick(() => {
    updateMusicPlayerOverlayMetrics();
    window.addEventListener('resize', updateMusicPlayerOverlayMetrics);
    if (typeof ResizeObserver !== 'undefined' && musicBrowserShell.value) {
      musicBrowserObserver = new ResizeObserver(() => {
        updateMusicPlayerOverlayMetrics();
      });
      musicBrowserObserver.observe(musicBrowserShell.value);
    }
  });
});

onUnmounted(() => {
  window.removeEventListener('resize', updateMusicPlayerOverlayMetrics);
  musicBrowserObserver?.disconnect();
  musicBrowserObserver = null;
});
</script>

<template>
  <section class="layout layout-wide music-layout" :class="{ 'sidebar-open': sidebarOpen }">
    <AppSidebar title="Music">
      <SidebarSection title="Library">
        <SidebarNavItem icon="fa-solid fa-music" :active="mode === 'songs'" @click="handleSelectMode('songs')">
          Songs
        </SidebarNavItem>
        <SidebarNavItem icon="fa-solid fa-compact-disc" :active="mode === 'albums'" @click="handleSelectMode('albums')">
          Albums
        </SidebarNavItem>
        <SidebarNavItem icon="fa-solid fa-user" :active="mode === 'artists'" @click="handleSelectMode('artists')">
          Artists
        </SidebarNavItem>
        <SidebarNavItem
          icon="fa-solid fa-list"
          :active="mode === 'playlists' && !selectedPlaylistId"
          @click="handleSelectMode('playlists')"
        >
          Playlists
        </SidebarNavItem>
      </SidebarSection>
      <SidebarSection title="Playlists">
        <SidebarNavItem
          v-for="playlist in playlists"
          :key="playlist.id"
          icon="fa-solid fa-list-music"
          :active="selectedPlaylistId === playlist.id"
          :count="playlist.tracks.length"
          @click="handleSelectPlaylist(playlist)"
          @contextmenu="openSidebarPlaylistMenu($event, playlist)"
        >
          {{ playlist.name }}
        </SidebarNavItem>
        <div v-if="!playlists.length" class="sidebar-hint">Right-click a track to add.</div>
      </SidebarSection>
      <SidebarSection title="Quick Access">
        <SidebarNavItem
          v-for="pin in musicPins"
          :key="pin.id"
          :icon="pin.albumKey ? 'fa-solid fa-compact-disc' : 'fa-solid fa-location-dot'"
          :active="activePin?.id === pin.id"
          @click="handlePinSelect(pin)"
          @contextmenu="openSidebarPinMenu($event, pin)"
        >
          {{ pin.label }}
        </SidebarNavItem>
        <div v-if="!musicPins.length" class="sidebar-hint">Right-click a track to pin.</div>
      </SidebarSection>
    </AppSidebar>
    <div class="sidebar-scrim" @click="closeSidebar"></div>

    <main ref="musicBrowserShell" class="browser music-browser">
      <ViewToolbar>
        <template #title>
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
            <button v-if="isArtistDetail" class="action-btn secondary" @click="clearArtistSelection()">
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
                  ? isArtistDetail
                    ? selectedArtist?.artist || 'Artist'
                    : 'Artists'
                  : 'Playlists'
              }}
            </strong>
            <span class="meta" v-if="mode === 'songs'">
              - {{ songsMeta }}
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
            <span class="meta" v-else-if="isArtistDetail">
              - {{ selectedArtistAlbumCount }} albums, {{ selectedArtistTrackCount }} tracks
            </span>
            <span class="meta" v-else>
              - {{ filteredArtists.length }} of {{ artistsTotal }}
            </span>
          </div>
        </template>
        <template #actions>
          <input
            v-if="
              mode === 'songs' ||
              (mode === 'albums' && !selectedAlbum) ||
              (mode === 'artists' && !isArtistDetail)
            "
            class="search"
            type="search"
            :placeholder="mode === 'songs' ? 'Search songs, albums, artists' : mode === 'albums' ? 'Filter albums' : 'Filter artists'"
            v-model="searchQuery"
          />
        </template>
      </ViewToolbar>

      <ViewScrollArea ref="musicScrollArea" class="music-scroll-area">
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
          <div class="album-detail-header detail-surface detail-surface-feature">
            <div class="album-detail-art">
              <img
                v-if="selectedAlbum.coverKey"
                :src="albumArtUrl(rootId, selectedAlbum.coverKey)"
                :alt="selectedAlbum.album"
              />
              <div v-else class="tile-fallback"><i class="fa-solid fa-compact-disc"></i></div>
            </div>
            <div class="album-detail-info detail-surface-copy">
              <div class="album-detail-title detail-surface-title">{{ selectedAlbumTitle }}</div>
              <div class="meta">{{ selectedAlbumArtist }}</div>
              <div v-if="selectedAlbum.releaseDate" class="meta">
                Released {{ selectedAlbum.releaseDate }}
              </div>
              <div class="meta">{{ albumTrackCount }} tracks</div>
            </div>
            <div class="album-detail-actions detail-surface-actions">
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
          <div class="playlist-detail-header detail-surface">
            <input
              class="playlist-name-input detail-surface-input"
              type="text"
              :value="selectedPlaylist.name"
              @input="updatePlaylistName($event.target.value)"
            />
            <div class="playlist-detail-actions detail-surface-actions">
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

        <div v-if="mode === 'artists' && !isArtistDetail" class="artist-list">
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

        <div v-if="isArtistDetail" class="artist-detail">
          <div class="artist-detail-header detail-surface">
            <div class="detail-surface-copy">
              <div class="album-detail-title detail-surface-title">{{ selectedArtist?.artist || 'Unknown Artist' }}</div>
              <div class="meta">{{ selectedArtistAlbumCount }} albums</div>
              <div class="meta">{{ selectedArtistTrackCount }} tracks</div>
            </div>
          </div>
          <div v-if="selectedArtistAlbums.length" class="artist-detail-albums">
            <div class="sidebar-title">Albums</div>
            <div class="artist-album-grid">
              <button
                v-for="album in selectedArtistAlbums"
                :key="album.key"
                class="album-card artist-album-card"
                @click="selectAlbum(album, { fromArtist: true })"
                @contextmenu.prevent="openAlbumMenu($event, album)"
              >
                <div class="album-art">
                  <img
                    v-if="album.coverKey && !hasArtistAlbumCoverError(album)"
                    :src="albumArtUrl(rootId, album.coverKey)"
                    :alt="album.album"
                    @error="markArtistAlbumCoverError(album)"
                  />
                  <div v-else class="tile-fallback"><i class="fa-solid fa-compact-disc"></i></div>
                </div>
                <div class="music-title">{{ album.album }}</div>
                <div class="meta">{{ album.tracks }} tracks</div>
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
        </div>

        <div ref="sentinel" class="scroll-sentinel"></div>
      </ViewScrollArea>

    </main>

    <Teleport to="body">
      <div class="music-player-overlay" :style="musicPlayerOverlayStyle">
        <MiniPlayer
          class="music-floating-player"
          :tracks="queue"
          :selected-track="selectedTrack"
          :root-id="rootId"
          :auto-play="true"
          @select="selectTrack"
        />
      </div>
    </Teleport>

    <div
      v-if="sidebarMenu.open"
      class="context-menu"
      :style="{ top: `${sidebarMenu.y}px`, left: `${sidebarMenu.x}px` }"
    >
      <button
        v-if="sidebarMenu.kind === 'playlist'"
        class="context-menu-item danger"
        @click="removeSidebarPlaylist(sidebarMenu.playlist)"
      >
        <i class="fa-solid fa-trash"></i>
        Remove playlist
      </button>
      <button
        v-if="sidebarMenu.kind === 'pin'"
        class="context-menu-item danger"
        @click="removeQuickAccess(sidebarMenu.pin)"
      >
        <i class="fa-solid fa-trash"></i>
        Remove quick access
      </button>
    </div>

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
        Pin quick access
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
      <button class="context-menu-item" @click="addPinForAlbum(albumMenu.album)">
        <i class="fa-regular fa-bookmark"></i>
        Pin quick access
      </button>
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
</template>
