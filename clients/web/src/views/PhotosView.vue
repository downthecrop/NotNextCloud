<script setup>
import { ref, computed, watch, onMounted } from 'vue';
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
import { formatDate, formatSize } from '../utils/formatting';
import { itemKey as buildItemKey } from '../utils/itemKey';
import { isImage, isVideo } from '../utils/media';
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
const startDate = ref('');
const endDate = ref('');
const {
  menu: contextMenu,
  openMenu: openContextMenuBase,
  closeMenu: closeContextMenu,
} = useMenu({ item: null });
const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
useGlobalMenuClose(closeContextMenu);
const {
  pins: photoPins,
  activePin,
  activePinPath,
  loadPins,
  addPinForItemPath,
  setActivePinFromPath,
  selectPin,
  clearPin,
} = usePinnedLocations({ storageKey: 'localCloudPhotoPins' });

const rootId = computed(() => props.currentRoot?.id || '');
function itemKey(item) {
  return buildItemKey(item);
}

const { hasImageError, markImageError, resetImageErrors } = useImageErrors({
  getKey: (item) => `${itemRootId(item)}:${item?.path || ''}`,
});
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const displayItems = computed(() => (isSearchMode.value ? searchResults.value : items.value));
const selectedAlbum = computed(
  () => albums.value.find((album) => album.id === selectedAlbumId.value) || null
);
const isAlbumDetail = computed(() => Boolean(selectedAlbum.value));
const albumItems = computed(() => selectedAlbum.value?.items || []);
const sortLabel = computed(() => (sortDir.value === 'desc' ? 'Newest' : 'Oldest'));
const hasMore = computed(() => {
  if (isAlbumDetail.value) {
    return false;
  }
  if (isSearchMode.value) {
    return hasMoreFromTotalOrCursor({
      itemsLength: searchResults.value.length,
      total: searchTotal.value,
      cursor: searchCursor.value,
    });
  }
  return hasMoreFromTotalOrCursor({
    itemsLength: items.value.length,
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
  return { startMs, endMs };
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

const timelineGroups = computed(() => {
  const groups = [];
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  let currentLabel = '';
  for (const item of sortedItems.value) {
    const label = formatter.format(new Date(item.mtime));
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
  albums.value = albums.value.filter((album) => album.id !== removingId);
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
  addPinForItemPath(item.path);
  closeContextMenu();
}

function handleAlbumClear() {
  clearAlbumSelection();
  closeSidebar();
}

function handleCreateAlbum() {
  selectAlbum(ensureDraftAlbum());
  closeSidebar();
}

function handleAlbumSelect(album) {
  selectAlbum(album);
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

function openContextMenu(event, item) {
  if (!isSelected(item)) {
    setSingleSelection(item);
  }
  openContextMenuBase(event, { item });
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
  const label = isAlbumDetail.value ? selectedAlbum.value?.name || 'album' : 'photos';
  await downloadSelection(selected, label);
  closeContextMenu();
}

async function handleDownloadAlbum() {
  if (!sortedAlbumItems.value.length) {
    return;
  }
  await downloadSelection(sortedAlbumItems.value, selectedAlbum.value?.name || 'album');
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

async function loadPhotos({ reset = true } = {}) {
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
    errorMessage: 'Failed to load photos',
    onReset: clearSelection,
    requestVersion,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      listMedia({
        rootId: props.currentRoot.id,
        type: 'photos',
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
  const query = searchQuery.value.trim();
  if (!query) {
    resetPagedState({ items: searchResults, total: searchTotal, offset: searchOffset, cursor: searchCursor });
    return;
  }
  await loadPaged({
    reset,
    items: searchResults,
    total: searchTotal,
    offset: searchOffset,
    cursor: searchCursor,
    loading,
    requestVersion,
    fetchPage: ({ offset: pageOffset, cursor: pageCursor }) =>
      searchEntries({
        rootId: props.currentRoot.id,
        type: 'photos',
        query,
        limit: props.pageSize,
        offset: pageOffset,
        cursor: pageCursor,
        pathPrefix: activePinPath.value || undefined,
        includeTotal: false,
      }),
  });
}

async function loadMore() {
  if (loading.value || !hasMore.value) {
    return;
  }
  if (isSearchMode.value) {
    await runSearch({ reset: false });
  } else {
    await loadPhotos({ reset: false });
  }
}

const { sentinel } = useInfiniteScroll(loadMore);

useDebouncedWatch(searchQuery, () => runSearch({ reset: true }));

watch(activePin, () => {
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
    activePin.value = null;
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
  () => {
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

watch([searchQuery, startDate, endDate, selectedAlbumId], () => {
  clearSelection();
});

onMounted(() => {
  loadAlbums();
  loadPins();
});

watch(
  () => displayItems.value,
  () => {
    attemptJumpOpen();
  }
);
</script>

<template>
  <section class="layout layout-wide photos-layout" :class="{ 'sidebar-open': sidebarOpen }">
    <aside class="sidebar">
      <h3>Photos</h3>
      <div class="sidebar-section">
        <div class="sidebar-title">Albums</div>
        <button class="sidebar-item" :class="{ active: !selectedAlbumId }" @click="handleAlbumClear">
          <span class="icon"><i class="fa-regular fa-images"></i></span>
          All photos
        </button>
        <button class="sidebar-item" @click="handleCreateAlbum">
          <span class="icon"><i class="fa-solid fa-plus"></i></span>
          Create album
        </button>
        <button
          v-for="album in albums"
          :key="album.id"
          class="sidebar-item"
          :class="{ active: selectedAlbumId === album.id }"
          @click="handleAlbumSelect(album)"
        >
          <span class="icon"><i class="fa-solid fa-photo-film"></i></span>
          <span class="sidebar-label">{{ album.name }}</span>
          <span class="sidebar-count">{{ album.items.length }}</span>
        </button>
        <div v-if="!albums.length" class="sidebar-hint">Add photos to start an album.</div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Pinned</div>
        <button class="sidebar-item" :class="{ active: !activePin }" @click="handlePinClear">
          <span class="icon"><i class="fa-regular fa-bookmark"></i></span>
          All locations
        </button>
        <button
          v-for="pin in photoPins"
          :key="pin.id"
          class="sidebar-item"
          :class="{ active: activePin?.id === pin.id }"
          @click="handlePinSelect(pin)"
        >
          <span class="icon"><i class="fa-solid fa-location-dot"></i></span>
          <span class="sidebar-label">{{ pin.label }}</span>
        </button>
        <div v-if="!photoPins.length" class="sidebar-hint">Right-click a photo to pin.</div>
      </div>
    </aside>
    <div class="sidebar-scrim" @click="closeSidebar"></div>

    <main class="browser photos-browser">
      <div class="toolbar">
        <div class="toolbar-title">
          <div class="toolbar-line">
            <button class="icon-btn sidebar-toggle" @click="toggleSidebar" aria-label="Toggle sidebar">
              <i class="fa-solid fa-bars"></i>
            </button>
            <button v-if="selectedAlbum" class="action-btn secondary" @click="clearAlbumSelection">
              <i class="fa-solid fa-arrow-left"></i>
              Back
            </button>
            <strong>{{ selectedAlbum ? selectedAlbum.name : 'Photos' }}</strong>
            <span class="meta" v-if="selectedAlbum"> - {{ albumItems.length }} items</span>
            <span class="meta" v-else>
              - {{ sortedItems.length }} of {{ isSearchMode ? searchTotal : total }}
            </span>
          </div>
        </div>
        <div class="toolbar-actions">
          <input
            v-if="!selectedAlbum"
            class="search"
            type="search"
            placeholder="Search photos and videos"
            v-model="searchQuery"
          />
          <div class="date-filter">
            <input type="date" v-model="startDate" aria-label="Start date" />
            <span>–</span>
            <input type="date" v-model="endDate" aria-label="End date" />
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
        </div>
      </div>

      <div v-if="loading && !displayItems.length" class="empty-state">Loading timeline...</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else-if="!displayItems.length" class="empty-state">
        Add photos or videos to your storage root to see the timeline.
      </div>

      <div v-else-if="!selectedAlbum" class="timeline">
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
                :src="previewUrl(itemRootId(item), item.path)"
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
        <div class="photo-album-header">
          <input
            class="photo-album-name"
            type="text"
            :value="selectedAlbum.name"
            @input="updateAlbumName($event.target.value)"
          />
          <div class="photo-album-actions">
            <button class="action-btn secondary" @click="saveAlbum">
              <i class="fa-solid fa-floppy-disk"></i>
              Save
            </button>
            <button
              class="action-btn secondary"
              @click="handleDownloadAlbum"
              :disabled="!sortedAlbumItems.length"
            >
              <i class="fa-solid fa-download"></i>
              Download album
            </button>
            <button class="action-btn secondary" @click="clearAlbum">
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
              v-if="(isImage(item) || isVideo(item)) && !hasImageError(item, 'album')"
              :src="previewUrl(itemRootId(item), item.path)"
              :alt="item.name"
              loading="lazy"
              @error="markImageError(item, 'album')"
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
    </main>
  </section>

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
      Pin location
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
