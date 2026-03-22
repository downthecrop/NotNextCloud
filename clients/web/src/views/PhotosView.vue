<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue';
import { useApi } from '../composables/useApi';
import { useDownloads } from '../composables/useDownloads';
import { useImageErrors } from '../composables/useImageErrors';
import { useInfiniteScroll } from '../composables/useInfiniteScroll';
import { useLibraryApi } from '../composables/useLibraryApi';
import { useDebouncedWatch } from '../composables/useDebouncedWatch';
import { useMediaModal } from '../composables/useMediaModal';
import { useMenu, useGlobalMenuClose } from '../composables/useMenu';
import { useMultiSelect } from '../composables/useMultiSelect';
import { useSort } from '../composables/useSort';
import { useSidebar } from '../composables/useSidebar';
import { useDraftCollection } from '../composables/useDraftCollection';
import { usePinnedLocations } from '../composables/usePinnedLocations';
import AppSidebar from '../components/AppSidebar.vue';
import SidebarNavItem from '../components/SidebarNavItem.vue';
import SidebarSection from '../components/SidebarSection.vue';
import ViewScrollArea from '../components/ViewScrollArea.vue';
import ViewToolbar from '../components/ViewToolbar.vue';
import { formatDate, formatSize } from '../utils/formatting';
import { itemKey as buildItemKey } from '../utils/itemKey';
import { isImage, isVideo } from '../utils/media';
import { hasMoreFromTotalOrCursor, loadPaged, resetPagedState } from '../utils/pagination';
import { parentPath, pathLabel } from '../utils/pathing';
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
  pageSize: {
    type: Number,
    required: true,
  },
  jumpTo: {
    type: Object,
    default: null,
  },
  onSelectRoot: {
    type: Function,
    required: true,
  },
  onOpenInFiles: {
    type: Function,
    default: null,
  },
});

const { fileUrl, previewUrl, downloadUrl } = useApi();
const { listMedia, searchEntries } = useLibraryApi();
const { downloadGrouped } = useDownloads();
const { sortDir, setSort, sortList, compareText } = useSort({
  initialKey: 'date',
  initialDir: 'desc',
});
const PHOTO_RENDER_QUEUE_MAX = 360;
const PHOTO_RENDER_QUEUE_CHUNK = 60;
const PHOTO_WHEEL_EDGE_THRESHOLD = 220;

const items = ref([]);
const total = ref(0);
const offset = ref(0);
const cursor = ref(null);
const searchQuery = ref('');
const searchResults = ref([]);
const searchTotal = ref(0);
const searchOffset = ref(0);
const searchCursor = ref(null);
const loading = ref(false);
const error = ref('');
const {
  entries: albums,
  loadEntries: loadAlbums,
  persistEntries: persistAlbums,
  ensureDraftEntry: ensureDraftAlbum,
  removeEntry: removeAlbumEntry,
} = useDraftCollection({
  storageKey: 'localCloudPhotoAlbums',
  counterKey: 'localCloudPhotoAlbumCounter',
  itemField: 'items',
  idPrefix: 'album',
  namePrefix: 'New Album',
});
const selectedAlbumId = ref(null);
const jumpTarget = ref(null);
const requestVersion = ref(0);
let searchAbortController = null;
let inFlightMediaRequest = null;
let inFlightSearchRequest = null;
const browserScroll = ref(null);
const topSentinel = ref(null);
const photoHeadBuffer = ref([]);
const photoTailBuffer = ref([]);
const searchHeadBuffer = ref([]);
const searchTailBuffer = ref([]);
let topObserver = null;
let topIntersecting = false;
let wheelRafId = 0;
let pendingWheelDelta = 0;
let topRestoreInFlight = false;
const startDate = ref('');
const endDate = ref('');
const photoBrowseMode = ref('timeline');
const {
  menu: contextMenu,
  openMenu: openContextMenuBase,
  closeMenu: closeContextMenu,
} = useMenu({ item: null });
const {
  menu: sidebarMenu,
  openMenu: openSidebarMenuBase,
  closeMenu: closeSidebarMenu,
} = useMenu({ kind: '', album: null, pin: null });
const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
useGlobalMenuClose([closeContextMenu, closeSidebarMenu]);
const {
  pins: photoPins,
  activePin,
  activePinPath,
  loadPins,
  addPinForItemPath,
  setActivePinFromPath,
  selectPin,
  removePin,
  clearPin,
} = usePinnedLocations({ storageKey: 'localCloudPhotoPins' });
const pendingPinSelection = ref(null);
const selectedPinnedAlbum = ref(null);

const rootId = computed(() => props.currentRoot?.id || '');
const browserScrollRoot = computed(() => browserScroll.value?.scrollEl || null);
const timelineDateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});
function itemKey(item) {
  return buildItemKey(item);
}

function getScrollContainer() {
  return browserScrollRoot.value;
}

const { hasImageError, markImageError, resetImageErrors } = useImageErrors({
  getKey: (item) => `${itemRootId(item)}:${item?.path || ''}`,
});
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const displayItems = computed(() => (isSearchMode.value ? searchResults.value : items.value));
const selectedAlbum = computed(
  () => albums.value.find((album) => album.id === selectedAlbumId.value) || null
);
const activeCollection = computed(() => selectedAlbum.value || selectedPinnedAlbum.value);
const isAlbumDetail = computed(() => Boolean(activeCollection.value));
const isFolderBrowseMode = computed(() => !activeCollection.value && photoBrowseMode.value === 'folders');
const albumItems = computed(() => {
  if (selectedAlbum.value) {
    return selectedAlbum.value.items || [];
  }
  if (selectedPinnedAlbum.value) {
    return displayItems.value;
  }
  return [];
});
const sortLabel = computed(() => (sortDir.value === 'desc' ? 'Newest' : 'Oldest'));
const visiblePhotoCount = computed(
  () => items.value.length + photoHeadBuffer.value.length + photoTailBuffer.value.length
);
const visibleSearchCount = computed(
  () => searchResults.value.length + searchHeadBuffer.value.length + searchTailBuffer.value.length
);
const photoQueryRootId = computed(() => {
  if (selectedPinnedAlbum.value?.rootId) {
    return selectedPinnedAlbum.value.rootId;
  }
  if (jumpTarget.value?.rootId && props.currentRoot?.id === ALL_ROOTS_ID) {
    return jumpTarget.value.rootId;
  }
  return props.currentRoot?.id || '';
});
const hasMore = computed(() => {
  if (isAlbumDetail.value) {
    return false;
  }
  if (isSearchMode.value) {
    if (searchTailBuffer.value.length > 0) {
      return true;
    }
    return hasMoreFromTotalOrCursor({
      itemsLength: visibleSearchCount.value,
      total: searchTotal.value,
      cursor: searchCursor.value,
    });
  }
  if (photoTailBuffer.value.length > 0) {
    return true;
  }
  return hasMoreFromTotalOrCursor({
    itemsLength: visiblePhotoCount.value,
    total: total.value,
    cursor: cursor.value,
  });
});

const selectionItems = computed(() =>
  isAlbumDetail.value ? sortedAlbumItems.value : sortedItems.value
);
const {
  selectedKeys: selectedItemKeys,
  clearSelection,
  setSingleSelection,
  toggleSelection,
  selectRange,
  isSelected,
} = useMultiSelect({
  getItems: () => selectionItems.value,
  getKey: (item) => itemKey(item),
});
const selectionCount = computed(() => selectedItemKeys.value.length);

function dateBounds() {
  if (!startDate.value || !endDate.value) {
    return { startMs: null, endMs: null };
  }
  let startMs = null;
  let endMs = null;
  if (startDate.value) {
    const start = new Date(startDate.value);
    start.setHours(0, 0, 0, 0);
    startMs = start.getTime();
  }
  if (endDate.value) {
    const end = new Date(endDate.value);
    end.setHours(23, 59, 59, 999);
    endMs = end.getTime();
  }
  if (startMs && endMs && startMs > endMs) {
    const nextStart = new Date(endMs);
    nextStart.setHours(0, 0, 0, 0);
    const nextEnd = new Date(startMs);
    nextEnd.setHours(23, 59, 59, 999);
    startMs = nextStart.getTime();
    endMs = nextEnd.getTime();
  }
  return { startMs, endMs };
}

function normalizeDateOrder() {
  if (!startDate.value || !endDate.value || startDate.value <= endDate.value) {
    return;
  }
  const nextStart = endDate.value;
  endDate.value = startDate.value;
  startDate.value = nextStart;
}

function clearDateRange() {
  startDate.value = '';
  endDate.value = '';
}


function filterByDate(list) {
  const { startMs, endMs } = dateBounds();
  if (!startMs && !endMs) {
    return list;
  }
  return list.filter((item) => {
    const time = Number(item?.mtime) || 0;
    if (startMs && time < startMs) {
      return false;
    }
    if (endMs && time > endMs) {
      return false;
    }
    return true;
  });
}

const filteredItems = computed(() => filterByDate(displayItems.value));
const filteredAlbumItems = computed(() => filterByDate(albumItems.value));
const photoFolders = computed(() => {
  const folders = new Map();
  for (const item of filteredItems.value) {
    const folderPath = parentPath(item?.path || '');
    const folderRootId = itemRootId(item);
    const key = `${folderRootId}:${folderPath}`;
    const existing = folders.get(key);
    if (existing) {
      existing.count += 1;
      if ((Number(item?.mtime) || 0) > existing.latest) {
        existing.latest = Number(item?.mtime) || 0;
        existing.cover = item;
      }
      continue;
    }
    folders.set(key, {
      id: key,
      key,
      path: folderPath,
      rootId: folderRootId,
      label:
        props.currentRoot?.id === ALL_ROOTS_ID
          ? `${rootName(folderRootId)} / ${pathLabel(folderPath, 'Root')}`
          : pathLabel(folderPath, 'Root'),
      shortLabel: pathLabel(folderPath, 'Root'),
      rootLabel: rootName(folderRootId),
      count: 1,
      latest: Number(item?.mtime) || 0,
      cover: item,
    });
  }
  return Array.from(folders.values()).sort(
    (a, b) => b.latest - a.latest || compareText(a.label, b.label)
  );
});

const sortedItems = computed(() =>
  sortPhotos(filteredItems.value)
);
const sortedAlbumItems = computed(() =>
  sortPhotos(filteredAlbumItems.value)
);

function sortPhotos(list) {
  return sortList(list, {
    getValue: (item) => Number(item?.mtime) || 0,
    numericKeys: ['date'],
    tieBreak: (a, b) => compareText(a?.name, b?.name),
  });
}

const modalItems = computed(() => (isAlbumDetail.value ? sortedAlbumItems.value : sortedItems.value));
const canRestoreFromTop = computed(() => {
  if (isAlbumDetail.value) {
    return false;
  }
  return isSearchMode.value ? searchHeadBuffer.value.length > 0 : photoHeadBuffer.value.length > 0;
});
const photosMeta = computed(() => {
  const totalValue = isSearchMode.value ? searchTotal.value : total.value;
  const loadedCount = isSearchMode.value ? visibleSearchCount.value : visiblePhotoCount.value;
  if (Number.isFinite(totalValue) && totalValue >= 0) {
    return `${loadedCount} of ${totalValue}`;
  }
  return `${loadedCount}`;
});

const timelineGroups = computed(() => {
  const groups = [];
  let currentLabel = '';
  for (const item of sortedItems.value) {
    const label = timelineDateFormatter.format(new Date(item.mtime));
    if (!groups.length || label !== currentLabel) {
      groups.push({ label, items: [] });
      currentLabel = label;
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
});

function itemRootId(item) {
  return item?.rootId || rootId.value;
}

function rootName(targetRootId) {
  return props.roots.find((root) => root.id === targetRootId)?.name || 'Root';
}

function tileClass(item) {
  return ['tile', { selected: isSelected(item) }];
}
const {
  modalOpen,
  modalItem,
  zoomLevel,
  openModal,
  closeModal,
  setModalItem,
  navigateModal,
  zoomIn,
  zoomOut,
} = useMediaModal({
  getItems: () => modalItems.value,
  getItemKey: (item) => item?.path || '',
  onSelect: (item) => setSingleSelection(item),
});

function handleItemClick(item, event) {
  const hasMeta = event?.metaKey || event?.ctrlKey;
  const hasShift = event?.shiftKey;
  if (hasShift) {
    selectRange(item, { additive: hasMeta });
    return;
  }
  if (hasMeta) {
    toggleSelection(item);
    return;
  }
  openModal(item);
}

function addItemToAlbum(item) {
  if (!item?.path) {
    return;
  }
  const draft = ensureDraftAlbum();
  if (draft.items.some((entry) => entry.path === item.path)) {
    closeContextMenu();
    return;
  }
  draft.items = [...draft.items, item];
  persistAlbums();
  closeContextMenu();
}

function selectAlbum(album) {
  selectedAlbumId.value = album?.id || null;
  searchQuery.value = '';
}

function clearAlbumSelection() {
  selectedAlbumId.value = null;
}

function saveAlbum() {
  if (!selectedAlbum.value) {
    return;
  }
  selectedAlbum.value.isDraft = false;
  persistAlbums();
}

function clearAlbum() {
  if (!selectedAlbum.value) {
    return;
  }
  const removingId = selectedAlbum.value.id;
  removeAlbumEntry(removingId);
  if (selectedAlbumId.value === removingId) {
    selectedAlbumId.value = null;
  }
  persistAlbums();
}

function updateAlbumName(value) {
  if (!selectedAlbum.value) {
    return;
  }
  selectedAlbum.value.name = value;
  persistAlbums();
}

function addPinForItem(item) {
  if (!item?.path) {
    return;
  }
  addPinForItemPath(item.path, {
    rootId: itemRootId(item),
    label: pathLabel(parentPath(item.path), 'Pinned album'),
    meta: {
      kind: 'album',
    },
  });
  closeContextMenu();
}

function buildPinnedAlbum(pin) {
  if (!pin?.path) {
    return null;
  }
  return {
    id: pin.id,
    name: pin.label || pathLabel(pin.path, 'Pinned album'),
    path: pin.path,
    rootId: pin.rootId || '',
    isPinned: true,
  };
}

function handleAlbumClear() {
  clearAlbumSelection();
  selectedPinnedAlbum.value = null;
  pendingPinSelection.value = null;
  clearPin();
  closeSidebar();
}

function handleCreateAlbum() {
  selectedPinnedAlbum.value = null;
  selectAlbum(ensureDraftAlbum());
  closeSidebar();
}

function handleAlbumSelect(album) {
  selectedPinnedAlbum.value = null;
  pendingPinSelection.value = null;
  clearPin();
  selectAlbum(album);
  closeSidebar();
}

async function handlePinClear() {
  selectedPinnedAlbum.value = null;
  pendingPinSelection.value = null;
  selectedAlbumId.value = null;
  searchQuery.value = '';
  clearPin();
  await loadPhotos({ reset: true });
  closeSidebar();
}

async function applyPhotoPinSelection(pin) {
  if (!pin?.path) {
    return;
  }
  selectedPinnedAlbum.value = buildPinnedAlbum(pin);
  selectPin(pin);
  selectedAlbumId.value = null;
  searchQuery.value = '';
  await loadPhotos({ reset: true });
}

async function handlePinSelect(pin) {
  if (!pin?.path) {
    closeSidebar();
    return;
  }
  pendingPinSelection.value = null;
  await applyPhotoPinSelection(pin);
  closeSidebar();
}

async function clearDetailSelection() {
  if (selectedAlbum.value) {
    clearAlbumSelection();
    return;
  }
  await handlePinClear();
}

async function openFolderCollection(folder) {
  if (!folder?.rootId) {
    return;
  }
  selectedAlbumId.value = null;
  selectedPinnedAlbum.value = {
    id: folder.id,
    name: folder.label,
    path: folder.path,
    rootId: folder.rootId,
    isPinned: false,
  };
  searchQuery.value = '';
  clearPin();
  await loadPhotos({ reset: true });
}

function openContextMenu(event, item) {
  if (!isSelected(item)) {
    setSingleSelection(item);
  }
  closeSidebarMenu();
  openContextMenuBase(event, { item });
}

function openSidebarAlbumMenu(event, album) {
  closeContextMenu();
  openSidebarMenuBase(event, { kind: 'album', album, pin: null });
}

function openSidebarPinMenu(event, pin) {
  closeContextMenu();
  openSidebarMenuBase(event, { kind: 'pin', album: null, pin });
}

async function downloadSelection(items, label) {
  const targets = Array.isArray(items) ? items : [];
  if (!targets.length) {
    return;
  }
  await downloadGrouped({
    items: targets,
    getRootId: (item) => itemRootId(item),
    getPath: (item) => item.path,
    getName: (item) => item.name || 'photo',
    zipLabel: label,
  });
}

async function handleDownloadSelection() {
  const selected = getSelectedItems();
  if (!selected.length) {
    return;
  }
  const label = isAlbumDetail.value ? activeCollection.value?.name || 'album' : 'photos';
  await downloadSelection(selected, label);
  closeContextMenu();
}

async function handleDownloadAlbum() {
  if (!sortedAlbumItems.value.length) {
    return;
  }
  await downloadSelection(sortedAlbumItems.value, activeCollection.value?.name || 'album');
}

function removeSidebarAlbum(album) {
  const albumId = album?.id || '';
  if (!albumId) {
    return;
  }
  removeAlbumEntry(albumId);
  if (selectedAlbumId.value === albumId) {
    selectedAlbumId.value = null;
  }
  persistAlbums();
  closeSidebarMenu();
}

async function removeQuickAccess(pin) {
  const pinId = pin?.id || '';
  if (!pinId) {
    return;
  }
  const wasActive = activePin.value?.id === pinId;
  removePin(pinId);
  if (wasActive) {
    selectedPinnedAlbum.value = null;
    selectedAlbumId.value = null;
    await loadPhotos({ reset: true });
  }
  closeSidebarMenu();
}

function handleOpenInFiles(item) {
  if (!item?.path || !props.onOpenInFiles) {
    return;
  }
  const pathValue = parentPath(item.path);
  props.onOpenInFiles({ rootId: itemRootId(item), path: pathValue });
  closeContextMenu();
}

function applyJump(jump) {
  if (!jump?.path) {
    return;
  }
  const pathValue = parentPath(jump.path);
  if (pathValue) {
    setActivePinFromPath(pathValue, {
      idPrefix: 'jump',
      token: jump.token || Date.now(),
    });
  } else {
    clearPin();
  }
  selectedAlbumId.value = null;
  jumpTarget.value = {
    rootId: jump.rootId || null,
    path: jump.path,
    token: jump.token || Date.now(),
  };
}

function attemptJumpOpen() {
  if (!jumpTarget.value?.path) {
    return;
  }
  const match = displayItems.value.find(
    (item) =>
      item?.path === jumpTarget.value.path &&
      (!jumpTarget.value.rootId || itemRootId(item) === jumpTarget.value.rootId)
  );
  if (!match) {
    return;
  }
  openModal(match);
  jumpTarget.value = null;
}

function getSelectedItems() {
  const list = selectionItems.value;
  if (!list.length || !selectedItemKeys.value.length) {
    return [];
  }
  const byKey = new Map(list.map((entry) => [itemKey(entry), entry]));
  return selectedItemKeys.value.map((key) => byKey.get(key)).filter(Boolean);
}

function clearRenderBuffers({ search = false } = {}) {
  if (search) {
    searchHeadBuffer.value = [];
    searchTailBuffer.value = [];
    return;
  }
  photoHeadBuffer.value = [];
  photoTailBuffer.value = [];
}

function appendToHeadBuffer(bufferRef, removed) {
  if (!Array.isArray(removed) || !removed.length) {
    return;
  }
  bufferRef.value = [...bufferRef.value, ...removed];
}

function prependToTailBuffer(bufferRef, removed) {
  if (!Array.isArray(removed) || !removed.length) {
    return;
  }
  bufferRef.value = [...removed, ...bufferRef.value];
}

function windowScrollTop() {
  const container = getScrollContainer();
  if (!container) {
    return 0;
  }
  return container.scrollTop || 0;
}

function windowScrollHeight() {
  const container = getScrollContainer();
  if (!container) {
    return 0;
  }
  return container.scrollHeight || 0;
}

function windowViewportHeight() {
  const container = getScrollContainer();
  if (!container) {
    return 0;
  }
  return container.clientHeight || 0;
}

function adjustWindowScrollByDelta(heightDelta) {
  const container = getScrollContainer();
  if (!Number.isFinite(heightDelta) || heightDelta === 0 || !container) {
    return;
  }
  const maxBefore = Math.max(0, windowScrollHeight() - windowViewportHeight());
  const current = windowScrollTop();
  const next = Math.max(0, Math.min(maxBefore, current + heightDelta));
  container.scrollTop = next;
}

async function withScrollAnchor(mutator) {
  const beforeHeight = windowScrollHeight();
  mutator();
  await nextTick();
  const afterHeight = windowScrollHeight();
  adjustWindowScrollByDelta(afterHeight - beforeHeight);
}

function trimWindowFromTop(listRef, headBufferRef) {
  if (!Array.isArray(listRef.value)) {
    return false;
  }
  const overflow = listRef.value.length - PHOTO_RENDER_QUEUE_MAX;
  if (overflow <= 0) {
    return false;
  }
  const removedTop = listRef.value.slice(0, overflow);
  listRef.value = listRef.value.slice(overflow);
  appendToHeadBuffer(headBufferRef, removedTop);
  return true;
}

function restoreFromHeadBuffer({ listRef, headBufferRef, tailBufferRef }) {
  const available = headBufferRef.value.length;
  if (!available) {
    return false;
  }
  const count = Math.min(PHOTO_RENDER_QUEUE_CHUNK, available);
  const start = available - count;
  const restored = headBufferRef.value.slice(start);
  headBufferRef.value = headBufferRef.value.slice(0, start);
  listRef.value = [...restored, ...listRef.value];
  const overflow = listRef.value.length - PHOTO_RENDER_QUEUE_MAX;
  if (overflow > 0) {
    const removedTail = listRef.value.slice(listRef.value.length - overflow);
    listRef.value = listRef.value.slice(0, listRef.value.length - overflow);
    prependToTailBuffer(tailBufferRef, removedTail);
  }
  return true;
}

function restoreFromTailBuffer({ listRef, headBufferRef, tailBufferRef }) {
  const available = tailBufferRef.value.length;
  if (!available) {
    return false;
  }
  const count = Math.min(PHOTO_RENDER_QUEUE_CHUNK, available);
  const restored = tailBufferRef.value.slice(0, count);
  tailBufferRef.value = tailBufferRef.value.slice(count);
  listRef.value = [...listRef.value, ...restored];
  const overflow = listRef.value.length - PHOTO_RENDER_QUEUE_MAX;
  if (overflow > 0) {
    const removedTop = listRef.value.slice(0, overflow);
    listRef.value = listRef.value.slice(overflow);
    appendToHeadBuffer(headBufferRef, removedTop);
  }
  return true;
}

async function trimCurrentWindowFromTop() {
  if (modalOpen.value || isAlbumDetail.value) {
    return false;
  }
  const useSearch = isSearchMode.value;
  const listRef = useSearch ? searchResults : items;
  const headBufferRef = useSearch ? searchHeadBuffer : photoHeadBuffer;
  if (!Array.isArray(listRef.value) || listRef.value.length <= PHOTO_RENDER_QUEUE_MAX) {
    return false;
  }
  await withScrollAnchor(() => {
    trimWindowFromTop(listRef, headBufferRef);
  });
  if (selectionCount.value) {
    clearSelection();
  }
  return true;
}

async function restoreFromTopWindow() {
  if (loading.value || isAlbumDetail.value || topRestoreInFlight) {
    return false;
  }
  topRestoreInFlight = true;
  let restored = false;
  const useSearch = isSearchMode.value;
  const listRef = useSearch ? searchResults : items;
  const headBufferRef = useSearch ? searchHeadBuffer : photoHeadBuffer;
  const tailBufferRef = useSearch ? searchTailBuffer : photoTailBuffer;
  await withScrollAnchor(() => {
    restored = restoreFromHeadBuffer({
      listRef,
      headBufferRef,
      tailBufferRef,
    });
  });
  topRestoreInFlight = false;
  if (restored && selectionCount.value) {
    clearSelection();
  }
  return restored;
}

function restoreFromBottomWindow() {
  const restored = isSearchMode.value
    ? restoreFromTailBuffer({
        listRef: searchResults,
        headBufferRef: searchHeadBuffer,
        tailBufferRef: searchTailBuffer,
      })
    : restoreFromTailBuffer({
        listRef: items,
        headBufferRef: photoHeadBuffer,
        tailBufferRef: photoTailBuffer,
      });
  if (restored && selectionCount.value) {
    clearSelection();
  }
  return restored;
}

function setupTopObserver() {
  if (topObserver) {
    topObserver.disconnect();
    topObserver = null;
  }
  topObserver = new IntersectionObserver(
    (entries) => {
      const entry = entries.find((item) => item.target === topSentinel.value);
      if (!entry) {
        return;
      }
      if (entry.isIntersecting && !topIntersecting) {
        topIntersecting = true;
        void restoreFromTopWindow();
      } else if (!entry.isIntersecting) {
        topIntersecting = false;
      }
    },
    {
      root: browserScrollRoot.value || null,
      rootMargin: '240px 0px 240px 0px',
    }
  );
  if (topSentinel.value) {
    topObserver.observe(topSentinel.value);
  }
}

function isNearWindowTop() {
  return windowScrollTop() <= PHOTO_WHEEL_EDGE_THRESHOLD;
}

function isNearWindowBottom() {
  const viewportHeight = windowViewportHeight();
  if (!viewportHeight) {
    return false;
  }
  const viewportBottom = windowScrollTop() + viewportHeight;
  return windowScrollHeight() - viewportBottom <= PHOTO_WHEEL_EDGE_THRESHOLD;
}

function handleWindowWheel(event) {
  if (isAlbumDetail.value || modalOpen.value) {
    return;
  }
  const deltaY = Number(event?.deltaY) || 0;
  if (!deltaY) {
    return;
  }
  pendingWheelDelta = deltaY;
  if (wheelRafId) {
    return;
  }
  wheelRafId = window.requestAnimationFrame(() => {
    wheelRafId = 0;
    const nextDelta = pendingWheelDelta;
    pendingWheelDelta = 0;
    if (nextDelta < 0) {
      if (isNearWindowTop()) {
        void restoreFromTopWindow();
      }
      return;
    }
    if (nextDelta > 0 && isNearWindowBottom()) {
      loadMore();
    }
  });
}

async function loadPhotos({ reset = true } = {}) {
  if (!photoQueryRootId.value) {
    return;
  }
  const requestKey = [
    photoQueryRootId.value,
    props.pageSize,
    activePinPath.value || '',
    reset ? 'reset' : 'append',
    reset ? 0 : offset.value || 0,
    reset ? '' : cursor.value || '',
  ].join('|');
  if (inFlightMediaRequest?.key === requestKey) {
    return inFlightMediaRequest.promise;
  }
  const requestPromise = loadPaged({
    reset,
    items,
    total,
    offset,
    cursor,
    loading,
    error,
    errorMessage: 'Failed to load photos',
    onReset: () => {
      clearSelection();
      clearRenderBuffers({ search: false });
    },
    requestVersion,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      listMedia({
        rootId: photoQueryRootId.value,
        type: 'photos',
        limit: props.pageSize,
        offset: pageOffset,
        cursor: pageCursor,
        pathPrefix: activePinPath.value || undefined,
        includeTotal: false,
      }),
  });
  inFlightMediaRequest = { key: requestKey, promise: requestPromise };
  try {
    const result = await requestPromise;
    if (result?.ok) {
      await trimCurrentWindowFromTop();
    }
    return result;
  } finally {
    if (inFlightMediaRequest?.promise === requestPromise) {
      inFlightMediaRequest = null;
    }
  }
}

async function runSearch({ reset = true } = {}) {
  if (!photoQueryRootId.value) {
    return;
  }
  const query = searchQuery.value.trim();
  if (searchAbortController) {
    searchAbortController.abort();
    searchAbortController = null;
  }
  if (!query) {
    resetPagedState({ items: searchResults, total: searchTotal, offset: searchOffset, cursor: searchCursor });
    clearRenderBuffers({ search: true });
    return;
  }
  const signal =
    typeof AbortController === 'undefined'
      ? null
      : (() => {
          searchAbortController = new AbortController();
          return searchAbortController.signal;
        })();
  const requestKey = [
    photoQueryRootId.value,
    props.pageSize,
    activePinPath.value || '',
    query,
    reset ? 'reset' : 'append',
    reset ? 0 : searchOffset.value || 0,
    reset ? '' : searchCursor.value || '',
  ].join('|');
  if (inFlightSearchRequest?.key === requestKey) {
    return inFlightSearchRequest.promise;
  }
  const requestPromise = loadPaged({
    reset,
    items: searchResults,
    total: searchTotal,
    offset: searchOffset,
    cursor: searchCursor,
    loading,
    onReset: () => {
      clearSelection();
      clearRenderBuffers({ search: true });
    },
    requestVersion,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      searchEntries({
        rootId: photoQueryRootId.value,
        type: 'photos',
        query,
        limit: props.pageSize,
        offset: pageOffset,
        cursor: pageCursor,
        pathPrefix: activePinPath.value || undefined,
        includeTotal: false,
        signal,
      }),
  });
  inFlightSearchRequest = { key: requestKey, promise: requestPromise };
  try {
    const result = await requestPromise;
    if (result?.ok) {
      await trimCurrentWindowFromTop();
    }
    return result;
  } finally {
    if (inFlightSearchRequest?.promise === requestPromise) {
      inFlightSearchRequest = null;
    }
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) {
    return;
  }
  if (restoreFromBottomWindow()) {
    return;
  }
  if (isSearchMode.value) {
    await runSearch({ reset: false });
  } else {
    await loadPhotos({ reset: false });
  }
}

const { sentinel } = useInfiniteScroll(loadMore, {
  canLoadMore: () => !loading.value && hasMore.value,
  rootRef: browserScrollRoot,
});

useDebouncedWatch(searchQuery, () => runSearch({ reset: true }));

watch(activePin, () => {
  if (selectedAlbumId.value || selectedPinnedAlbum.value) {
    return;
  }
  searchQuery.value = '';
  loadPhotos({ reset: true });
});

watch(
  () => props.currentRoot,
  () => {
    searchQuery.value = '';
    modalItem.value = null;
    modalOpen.value = false;
    resetImageErrors();
    selectedAlbumId.value = null;
    if (pendingPinSelection.value) {
      selectPin(pendingPinSelection.value);
      selectedPinnedAlbum.value = buildPinnedAlbum(pendingPinSelection.value);
      pendingPinSelection.value = null;
    } else {
      selectedPinnedAlbum.value = null;
      clearPin();
    }
    loadPhotos({ reset: true });
  },
  { immediate: true }
);

watch(
  () => props.pageSize,
  () => {
    if (isSearchMode.value) {
      runSearch({ reset: true });
    } else {
      loadPhotos({ reset: true });
    }
  }
);

watch(
  () => props.roots,
  (nextRoots, prevRoots) => {
    if (!Array.isArray(prevRoots) || prevRoots.length === 0) {
      return;
    }
    const nextIds = nextRoots.map((root) => root?.id || '').join('|');
    const prevIds = prevRoots.map((root) => root?.id || '').join('|');
    if (nextIds === prevIds) {
      return;
    }
    if (props.currentRoot?.id === ALL_ROOTS_ID) {
      loadPhotos({ reset: true });
    }
  }
);

watch(
  () => props.jumpTo?.token,
  () => {
    if (props.jumpTo?.path) {
      applyJump(props.jumpTo);
    }
  },
  { immediate: true }
);

watch([startDate, endDate], () => {
  normalizeDateOrder();
});

watch([searchQuery, startDate, endDate, selectedAlbumId], () => {
  clearSelection();
});

watch(activeCollection, (value) => {
  if (value) {
    return;
  }
  photoBrowseMode.value = 'timeline';
});

onMounted(() => {
  setupTopObserver();
  loadAlbums();
  loadPins();
});

onUnmounted(() => {
  const container = getScrollContainer();
  if (container) {
    container.removeEventListener('wheel', handleWindowWheel);
  }
  if (typeof window !== 'undefined' && wheelRafId) {
    window.cancelAnimationFrame(wheelRafId);
    wheelRafId = 0;
  }
  if (topObserver) {
    topObserver.disconnect();
    topObserver = null;
  }
});

watch(topSentinel, (value, oldValue) => {
  if (!topObserver) {
    return;
  }
  topIntersecting = false;
  if (oldValue) {
    topObserver.unobserve(oldValue);
  }
  if (value) {
    topObserver.observe(value);
  }
});

watch(browserScrollRoot, (value, oldValue) => {
  if (oldValue) {
    oldValue.removeEventListener('wheel', handleWindowWheel);
  }
  if (value) {
    value.addEventListener('wheel', handleWindowWheel, { passive: true });
  }
  setupTopObserver();
}, { immediate: true });

watch(
  () => displayItems.value,
  () => {
    attemptJumpOpen();
  }
);
</script>

<template>
  <section class="layout layout-wide photos-layout" :class="{ 'sidebar-open': sidebarOpen }">
    <AppSidebar title="Photos">
      <SidebarSection title="Albums">
        <SidebarNavItem icon="fa-regular fa-images" :active="!activeCollection" @click="handleAlbumClear">
          All photos
        </SidebarNavItem>
        <SidebarNavItem icon="fa-solid fa-plus" @click="handleCreateAlbum">
          Create album
        </SidebarNavItem>
        <SidebarNavItem
          v-for="album in albums"
          :key="album.id"
          icon="fa-solid fa-photo-film"
          :active="selectedAlbumId === album.id"
          :count="album.items.length"
          @click="handleAlbumSelect(album)"
          @contextmenu="openSidebarAlbumMenu($event, album)"
        >
          {{ album.name }}
        </SidebarNavItem>
        <div v-if="!albums.length" class="sidebar-hint">Add photos to start an album.</div>
      </SidebarSection>
      <SidebarSection title="Quick Access">
        <SidebarNavItem
          v-for="pin in photoPins"
          :key="pin.id"
          icon="fa-solid fa-photo-film"
          :active="activePin?.id === pin.id"
          @click="handlePinSelect(pin)"
          @contextmenu="openSidebarPinMenu($event, pin)"
        >
          {{ pin.label }}
        </SidebarNavItem>
        <div v-if="!photoPins.length" class="sidebar-hint">Right-click a photo to pin.</div>
      </SidebarSection>
    </AppSidebar>
    <div class="sidebar-scrim" @click="closeSidebar"></div>

    <main class="browser photos-browser">
      <ViewToolbar>
        <template #title>
          <div class="toolbar-line">
            <button class="icon-btn sidebar-toggle" @click="toggleSidebar" aria-label="Toggle sidebar">
              <i class="fa-solid fa-bars"></i>
            </button>
            <button v-if="activeCollection" class="action-btn secondary" @click="clearDetailSelection">
              <i class="fa-solid fa-arrow-left"></i>
              Back
            </button>
            <strong>{{ activeCollection ? activeCollection.name : 'Photos' }}</strong>
            <span class="meta" v-if="activeCollection"> - {{ albumItems.length }} items</span>
            <span class="meta" v-else>
              - {{ photosMeta }}
            </span>
          </div>
        </template>
        <template #actions>
          <input
            v-if="!activeCollection"
            class="search"
            type="search"
            placeholder="Search photos and videos"
            v-model="searchQuery"
          />
          <div v-if="!activeCollection" class="view-toggle">
            <button :class="{ active: photoBrowseMode === 'timeline' }" @click="photoBrowseMode = 'timeline'">
              Timeline
            </button>
            <button :class="{ active: photoBrowseMode === 'folders' }" @click="photoBrowseMode = 'folders'">
              Folders
            </button>
          </div>
          <div class="date-filter compact-pill">
            <label
              class="date-filter-btn"
              :class="{ active: Boolean(startDate) }"
              :title="startDate ? `Start date: ${startDate}` : 'Set start date'"
            >
              <input type="date" v-model="startDate" aria-label="Start date" />
              <i class="fa-regular fa-calendar"></i>
            </label>
            <label
              class="date-filter-btn"
              :class="{ active: Boolean(endDate) }"
              :title="endDate ? `End date: ${endDate}` : 'Set end date'"
            >
              <input type="date" v-model="endDate" aria-label="End date" />
              <i class="fa-solid fa-calendar-check"></i>
            </label>
            <button
              v-if="startDate || endDate"
              type="button"
              class="date-filter-btn clear"
              title="Clear date range"
              aria-label="Clear date range"
              @click="clearDateRange"
            >
              <i class="fa-solid fa-xmark"></i>
            </button>
          </div>
          <button class="action-btn secondary" @click="setSort('date')">
            <i class="fa-solid fa-arrow-down-wide-short"></i>
            {{ sortLabel }}
          </button>
          <button
            v-if="selectionCount"
            class="action-btn secondary"
            @click="handleDownloadSelection"
          >
            Download ({{ selectionCount }})
          </button>
        </template>
      </ViewToolbar>

      <ViewScrollArea ref="browserScroll">
        <div v-if="loading && !displayItems.length" class="empty-state">Loading timeline...</div>
        <div v-else-if="error" class="empty-state">{{ error }}</div>
        <div v-else-if="!displayItems.length" class="empty-state">
          Add photos or videos to your storage root to see the timeline.
        </div>

        <div v-else-if="isFolderBrowseMode" class="photo-folder-browser">
          <button
            v-for="folder in photoFolders"
            :key="folder.key"
            class="photo-folder-card"
            @click="openFolderCollection(folder)"
          >
            <div class="photo-folder-cover">
              <img
                v-if="folder.cover && !hasImageError(folder.cover, 'folder')"
                :src="previewUrl(folder.rootId, folder.cover.path, { previewKey: folder.cover.previewKey, mtime: folder.cover.mtime, mime: folder.cover.mime })"
                :alt="folder.shortLabel"
                loading="lazy"
                @error="markImageError(folder.cover, 'folder')"
              />
              <div
                v-else
                class="tile-fallback media-fallback compact"
              >
                <i class="fa-solid fa-folder-open"></i>
                <span>{{ folder.count }} items</span>
              </div>
            </div>
            <div class="photo-folder-card-copy">
              <strong>{{ folder.shortLabel }}</strong>
              <div class="meta" v-if="currentRoot?.id === ALL_ROOTS_ID">{{ folder.rootLabel }}</div>
              <div class="meta">{{ folder.count }} items</div>
            </div>
          </button>
          <div v-if="!photoFolders.length" class="empty-state">
            No folders found for the current filters.
          </div>
        </div>
        <div v-else-if="!activeCollection" class="timeline">
          <div v-if="canRestoreFromTop" ref="topSentinel" class="scroll-sentinel"></div>
          <div v-for="group in timelineGroups" :key="group.label" class="timeline-group">
            <div class="timeline-label">{{ group.label }}</div>
            <div class="timeline-grid">
              <div
                v-for="(item, index) in group.items"
                :key="itemKey(item)"
                :class="tileClass(item)"
                @click="handleItemClick(item, $event)"
                @contextmenu.prevent="openContextMenu($event, item)"
              >
                <img
                  v-if="(isImage(item) || isVideo(item)) && !hasImageError(item, 'tile')"
                  :src="previewUrl(itemRootId(item), item.path, { previewKey: item.previewKey, mtime: item.mtime, mime: item.mime })"
                  :alt="item.name"
                  loading="lazy"
                  @error="markImageError(item, 'tile')"
                />
                <div
                  v-else-if="isImage(item) || isVideo(item)"
                  class="tile-fallback media-fallback compact"
                >
                  <i class="fa-solid fa-file-circle-xmark"></i>
                  <span>{{ item.ext?.replace('.', '').toUpperCase() || 'FILE' }}</span>
                </div>
                <div v-else class="tile-fallback"><i class="fa-solid fa-file"></i></div>
                <span v-if="isVideo(item)" class="tile-badge" aria-hidden="true">
                  <i class="fa-solid fa-video"></i>
                </span>
              </div>
            </div>
          </div>
        </div>
        <div v-else class="photo-album-detail">
          <div class="photo-album-header detail-surface">
            <input
              v-if="selectedAlbum"
              class="photo-album-name detail-surface-input"
              type="text"
              :value="selectedAlbum.name"
              @input="updateAlbumName($event.target.value)"
            />
            <div v-else class="photo-album-copy detail-surface-copy">
              <div class="photo-album-name static detail-surface-title">{{ activeCollection?.name }}</div>
              <div class="meta">{{ activeCollection?.path }}</div>
            </div>
            <div class="photo-album-actions detail-surface-actions">
              <button v-if="selectedAlbum" class="action-btn secondary" @click="saveAlbum">
                <i class="fa-solid fa-floppy-disk"></i>
                Save
              </button>
              <button
                class="action-btn secondary"
                @click="handleDownloadAlbum"
                :disabled="!sortedAlbumItems.length"
              >
                <i class="fa-solid fa-download"></i>
                Download {{ selectedAlbum ? 'album' : 'quick access' }}
              </button>
              <button v-if="selectedAlbum" class="action-btn secondary" @click="clearAlbum">
                <i class="fa-solid fa-trash"></i>
                Clear
              </button>
            </div>
          </div>
          <div v-if="!albumItems.length" class="empty-state">This album is empty.</div>
          <div v-else class="photo-album-grid">
            <div
              v-for="(item, index) in sortedAlbumItems"
              :key="itemKey(item)"
              :class="tileClass(item)"
              @click="handleItemClick(item, $event)"
              @contextmenu.prevent="openContextMenu($event, item)"
            >
              <img
                v-if="(isImage(item) || isVideo(item)) && !hasImageError(item, 'tile')"
                :src="previewUrl(itemRootId(item), item.path, { previewKey: item.previewKey, mtime: item.mtime, mime: item.mime })"
                :alt="item.name"
                loading="lazy"
                @error="markImageError(item, 'tile')"
              />
              <div
                v-else-if="isImage(item) || isVideo(item)"
                class="tile-fallback media-fallback compact"
              >
                <i class="fa-solid fa-file-circle-xmark"></i>
                <span>{{ item.ext?.replace('.', '').toUpperCase() || 'FILE' }}</span>
              </div>
              <div v-else class="tile-fallback"><i class="fa-solid fa-file"></i></div>
              <span v-if="isVideo(item)" class="tile-badge" aria-hidden="true">
                <i class="fa-solid fa-video"></i>
              </span>
            </div>
          </div>
        </div>

        <div v-if="hasMore" class="empty-state">
          <button class="action-btn secondary" @click="loadMore">Load more</button>
        </div>
        <div ref="sentinel" class="scroll-sentinel"></div>
      </ViewScrollArea>
    </main>
  </section>

  <div
    v-if="sidebarMenu.open"
    class="context-menu"
    :style="{ top: `${sidebarMenu.y}px`, left: `${sidebarMenu.x}px` }"
  >
    <button
      v-if="sidebarMenu.kind === 'album'"
      class="context-menu-item danger"
      @click="removeSidebarAlbum(sidebarMenu.album)"
    >
      <i class="fa-solid fa-trash"></i>
      Remove album
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
    <button class="context-menu-item" @click="addItemToAlbum(contextMenu.item)">
      <i class="fa-solid fa-plus"></i>
      Add to album
    </button>
    <button class="context-menu-item" @click="addPinForItem(contextMenu.item)">
      <i class="fa-regular fa-bookmark"></i>
      Pin quick access
    </button>
    <button class="context-menu-item" @click="handleOpenInFiles(contextMenu.item)">
      <i class="fa-solid fa-folder-open"></i>
      Open in Files
    </button>
    <button class="context-menu-item" @click="handleDownloadSelection">
      <i class="fa-solid fa-download"></i>
      {{ selectionCount > 1 ? `Download selection (${selectionCount})` : 'Download' }}
    </button>
  </div>

  <div v-if="modalOpen && modalItem" class="modal-overlay photo-modal" @click.self="closeModal">
    <div class="photo-modal-controls">
      <button class="icon-btn" @click="zoomOut" aria-label="Zoom out">
        <i class="fa-solid fa-magnifying-glass-minus"></i>
      </button>
      <button class="icon-btn" @click="zoomIn" aria-label="Zoom in">
        <i class="fa-solid fa-magnifying-glass-plus"></i>
      </button>
      <a
        class="icon-btn"
        :href="downloadUrl(itemRootId(modalItem), modalItem.path)"
        aria-label="Download"
      >
        <i class="fa-solid fa-download"></i>
      </a>
      <button class="icon-btn" @click="closeModal" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <div class="photo-modal-stage" @click.self="closeModal">
      <img
        v-if="isImage(modalItem) && !hasImageError(modalItem, 'modal')"
        :src="fileUrl(itemRootId(modalItem), modalItem.path)"
        :alt="modalItem.name"
        :style="{ transform: `scale(${zoomLevel})` }"
        @error="markImageError(modalItem, 'modal')"
      />
      <div v-else-if="isImage(modalItem)" class="media-fallback">
        <i class="fa-solid fa-file-circle-xmark"></i>
        <div>Preview unavailable</div>
        <div class="media-fallback-meta">
          {{ modalItem.ext?.replace('.', '').toUpperCase() || 'FILE' }}
        </div>
      </div>
      <video
        v-else-if="isVideo(modalItem)"
        :src="fileUrl(itemRootId(modalItem), modalItem.path)"
        controls
      ></video>
      <div v-else class="tile-fallback"><i class="fa-solid fa-file"></i></div>
    </div>

    <div class="photo-modal-meta">
      <div><strong>{{ modalItem.name }}</strong></div>
      <div>{{ modalItem.path }}</div>
      <div>Type: {{ modalItem.mime }}</div>
      <div>Size: {{ formatSize(modalItem.size) }}</div>
      <div>Modified: {{ formatDate(modalItem.mtime) }}</div>
    </div>
  </div>
</template>
