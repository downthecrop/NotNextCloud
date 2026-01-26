<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import { useApi } from '../composables/useApi';
import { useDownloads } from '../composables/useDownloads';
import { useImageErrors } from '../composables/useImageErrors';
import { useInfiniteScroll } from '../composables/useInfiniteScroll';
import { useMenu, useGlobalMenuClose } from '../composables/useMenu';
import { useMultiSelect } from '../composables/useMultiSelect';
import { useSidebar } from '../composables/useSidebar';
import MiniPlayer from '../components/MiniPlayer.vue';
import { formatDate, formatSize } from '../utils/formatting';
import { itemKey as buildItemKey } from '../utils/itemKey';
import { isAudio, isImage, isMedia, isVideo } from '../utils/media';

const props = defineProps({
  roots: {
    type: Array,
    required: true,
  },
  currentRoot: {
    type: Object,
    default: null,
  },
  navState: {
    type: Object,
    default: null,
  },
  pageSize: {
    type: Number,
    required: true,
  },
  onSelectRoot: {
    type: Function,
    required: true,
  },
  onOpenInMusic: {
    type: Function,
    default: null,
  },
  onOpenInPhotos: {
    type: Function,
    default: null,
  },
});

const { apiFetch, fileUrl, previewUrl, downloadUrl } = useApi();
const { downloadFile, downloadZipPaths } = useDownloads();

const currentPath = ref('');
const items = ref([]);
const listTotal = ref(0);
const listOffset = ref(0);
const searchQuery = ref('');
const searchAllRoots = ref(false);
const searchResults = ref([]);
const searchTotal = ref(0);
const searchOffset = ref(0);
const viewMode = ref('list');
const loading = ref(false);
const error = ref('');
const { sidebarOpen, toggleSidebar, closeSidebar } = useSidebar();
const modalOpen = ref(false);
const modalItem = ref(null);
const zoomLevel = ref(1);
const {
  menu: breadcrumbMenu,
  openMenu: openBreadcrumbMenuBase,
  closeMenu: closeBreadcrumbMenu,
} = useMenu({ path: '' });
const {
  menu: itemMenu,
  openMenu: openItemMenuBase,
  closeMenu: closeItemMenu,
} = useMenu({ item: null });
const lastNavToken = ref(0);
const pendingOpen = ref(null);
useGlobalMenuClose([closeBreadcrumbMenu, closeItemMenu]);

const rootId = computed(() => props.currentRoot?.id || '');
function itemRootId(item) {
  return item?.rootId || rootId.value;
}
function itemKey(item) {
  return buildItemKey(item, rootId.value);
}
const { hasImageError, markImageError, resetImageErrors } = useImageErrors({
  getKey: (item) => `${itemRootId(item)}:${item?.path || ''}`,
});
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const displayItems = computed(() => (isSearchMode.value ? searchResults.value : items.value));
const {
  selectedKeys: selectedPaths,
  clearSelection,
  setSingleSelection,
  toggleSelection: toggleItemSelection,
  selectRange,
  isSelected,
} = useMultiSelect({
  getItems: () => displayItems.value,
  getKey: (item) => itemKey(item),
});
const selectionCount = computed(() => selectedPaths.value.length);
const selectedItems = computed(() => {
  if (!selectedPaths.value.length) {
    return [];
  }
  const byKey = new Map(displayItems.value.map((item) => [itemKey(item), item]));
  return selectedPaths.value.map((key) => byKey.get(key)).filter(Boolean);
});
const hasMore = computed(() => {
  if (isSearchMode.value) {
    return searchResults.value.length < searchTotal.value;
  }
  return items.value.length < listTotal.value;
});
const audioQueue = computed(() => displayItems.value.filter((item) => isAudio(item)));
const selectedAudioTrack = computed(() =>
  activeItem.value && isAudio(activeItem.value) ? activeItem.value : null
);
const modalAudioTrack = computed(() =>
  modalItem.value && isAudio(modalItem.value) ? modalItem.value : null
);

const breadcrumbs = computed(() => {
  if (!props.currentRoot) {
    return [];
  }
  const parts = currentPath.value ? currentPath.value.split('/') : [];
  const crumbs = [{ name: props.currentRoot.name, path: '' }];
  let acc = '';
  for (const part of parts) {
    acc = acc ? `${acc}/${part}` : part;
    crumbs.push({ name: part, path: acc });
  }
  return crumbs;
});

const activeItem = computed(() => {
  if (!selectedPaths.value.length) {
    return null;
  }
  const needle = selectedPaths.value[selectedPaths.value.length - 1];
  return (
    displayItems.value.find((item) => itemKey(item) === needle) ||
    items.value.find((item) => itemKey(item) === needle) ||
    searchResults.value.find((item) => itemKey(item) === needle) ||
    null
  );
});

async function scheduleScan(mode, pathValue) {
  if (!props.currentRoot) {
    return;
  }
  await apiFetch('/api/scan', {
    method: 'POST',
    body: JSON.stringify({
      root: props.currentRoot.id,
      path: pathValue || '',
      mode,
    }),
  });
}

async function refreshPath(pathValue) {
  await scheduleScan('full', pathValue);
  closeBreadcrumbMenu();
}

async function forceRehashPath(pathValue) {
  await scheduleScan('rehash', pathValue);
  closeBreadcrumbMenu();
}

function openBreadcrumbMenu(event, crumb, index) {
  if (index !== breadcrumbs.value.length - 1) {
    return;
  }
  closeItemMenu();
  openBreadcrumbMenuBase(event, { path: crumb.path || '' });
}

function openItemMenu(event, item) {
  event.preventDefault();
  closeBreadcrumbMenu();
  if (!isSelected(item)) {
    setSingleSelection(item);
  }
  openItemMenuBase(event, { item });
}

function handleItemDownload(item) {
  if (!item?.path || !itemRootId(item)) {
    return;
  }
  const targetRootId = itemRootId(item);
  if (item.isDir) {
    downloadZipPaths({
      rootId: targetRootId,
      paths: [item.path],
      zipLabel: 'files',
    });
  } else {
    downloadFile({
      rootId: targetRootId,
      path: item.path,
      filename: item.name || 'download',
    });
  }
  closeItemMenu();
}

function handleDownloadSelection() {
  downloadZip();
  closeItemMenu();
}

function handleOpenInMusic(item) {
  if (!item?.path || !props.onOpenInMusic) {
    return;
  }
  if (!isAudio(item)) {
    return;
  }
  props.onOpenInMusic({
    rootId: itemRootId(item),
    path: item.path,
    albumKey: item.albumKey || null,
  });
  closeItemMenu();
}

function handleOpenInPhotos(item) {
  if (!item?.path || !props.onOpenInPhotos) {
    return;
  }
  if (!isImage(item)) {
    return;
  }
  props.onOpenInPhotos({
    rootId: itemRootId(item),
    path: item.path,
  });
  closeItemMenu();
}

function handleRootSelect(root) {
  props.onSelectRoot(root);
  closeSidebar();
}

function iconClass(item) {
  if (item.isDir) {
    return 'fa-solid fa-folder';
  }
  if (isImage(item)) {
    return 'fa-solid fa-image';
  }
  if (isVideo(item)) {
    return 'fa-solid fa-film';
  }
  if (isAudio(item)) {
    return 'fa-solid fa-music';
  }
  return 'fa-solid fa-file';
}

async function loadList({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  if (reset) {
    listOffset.value = 0;
    listTotal.value = 0;
    items.value = [];
    clearSelection();
  }
  loading.value = true;
  error.value = '';
  try {
    const offset = reset ? 0 : listOffset.value;
    const res = await apiFetch(
      `/api/list?root=${encodeURIComponent(props.currentRoot.id)}` +
        `&path=${encodeURIComponent(currentPath.value)}` +
        `&limit=${props.pageSize}&offset=${offset}`
    );
    if (!res.ok) {
      error.value = 'Failed to load directory';
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    items.value = reset ? newItems : [...items.value, ...newItems];
    listTotal.value = data.total || 0;
    listOffset.value = offset + newItems.length;
  } catch (err) {
    error.value = 'Failed to load directory';
  } finally {
    loading.value = false;
  }
}

async function runSearch({ reset = true } = {}) {
  const targetRootId = searchAllRoots.value ? '__all__' : props.currentRoot?.id;
  if (!targetRootId) {
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
    clearSelection();
  }
  loading.value = true;
  try {
    const offset = reset ? 0 : searchOffset.value;
    const res = await apiFetch(
      `/api/search?root=${encodeURIComponent(targetRootId)}` +
        `&q=${encodeURIComponent(query)}` +
        `&limit=${props.pageSize}&offset=${offset}`
    );
    if (!res.ok) {
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    searchResults.value = reset ? newItems : [...searchResults.value, ...newItems];
    searchTotal.value = data.total || 0;
    searchOffset.value = offset + newItems.length;
  } catch (err) {
    searchResults.value = [];
  } finally {
    loading.value = false;
  }
}

async function openItem(item) {
  if (item.isDir) {
    if (itemRootId(item) && itemRootId(item) !== rootId.value) {
      const targetRoot = props.roots.find((root) => root.id === itemRootId(item));
      if (targetRoot) {
        pendingOpen.value = { path: item.path, rootId: itemRootId(item) };
        props.onSelectRoot(targetRoot);
      }
      return;
    }
    currentPath.value = item.path;
    searchQuery.value = '';
    await loadList({ reset: true });
    return;
  }
}

function openModal(item) {
  modalItem.value = item;
  setSingleSelection(item);
  zoomLevel.value = 1;
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

function setModalItem(item) {
  if (!item) {
    return;
  }
  modalItem.value = item;
  setSingleSelection(item);
  zoomLevel.value = 1;
}

function navigateModal(delta) {
  const list = displayItems.value.filter((entry) => isMedia(entry));
  if (!modalItem.value || !list.length) {
    return;
  }
  const index = list.findIndex((entry) => entry.path === modalItem.value.path);
  if (index < 0) {
    return;
  }
  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= list.length) {
    return;
  }
  setModalItem(list[nextIndex]);
}

function zoomIn() {
  zoomLevel.value = Math.min(3, zoomLevel.value + 0.25);
}

function zoomOut() {
  zoomLevel.value = Math.max(1, zoomLevel.value - 0.25);
}

async function handleItemClick(item, event) {
  const hasMeta = event?.metaKey || event?.ctrlKey;
  const hasShift = event?.shiftKey;
  const hasModifier = hasMeta || hasShift;

  if (item.isDir && !hasModifier) {
    await openItem(item);
    return;
  }

  if (hasShift) {
    selectRange(item, { additive: hasMeta });
    return;
  }

  if (hasMeta) {
    toggleItemSelection(item);
    return;
  }

  setSingleSelection(item);
  if (!item.isDir && isMedia(item)) {
    openModal(item);
  }
}

function handlePlayerSelect(track) {
  if (!track?.path) {
    return;
  }
  setSingleSelection(track);
}

function handleModalPlayerSelect(track) {
  setModalItem(track);
}

function goToCrumb(crumb) {
  currentPath.value = crumb.path;
  searchQuery.value = '';
  loadList({ reset: true });
}

async function downloadZip() {
  const targetItems = selectedItems.value;
  if (!targetItems.length) {
    return;
  }
  const grouped = new Map();
  for (const item of targetItems) {
    const targetRootId = itemRootId(item);
    if (!targetRootId || !item?.path) {
      continue;
    }
    if (!grouped.has(targetRootId)) {
      grouped.set(targetRootId, []);
    }
    grouped.get(targetRootId).push(item.path);
  }
  for (const [targetRootId, paths] of grouped.entries()) {
    if (!paths.length) {
      continue;
    }
    await downloadZipPaths({
      rootId: targetRootId,
      paths,
      zipLabel: 'files',
      includeRoot: grouped.size > 1,
    });
  }
}

async function loadMore() {
  if (loading.value || !hasMore.value) {
    return;
  }
  if (isSearchMode.value) {
    await runSearch({ reset: false });
  } else {
    await loadList({ reset: false });
  }
}

const { sentinel } = useInfiniteScroll(loadMore);

let searchTimer = null;
watch(searchQuery, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch({ reset: true }), 250);
});

watch(searchAllRoots, () => {
  clearSelection();
  if (isSearchMode.value) {
    runSearch({ reset: true });
  }
});

watch(
  () => props.currentRoot,
  () => {
    currentPath.value = '';
    searchQuery.value = '';
    modalItem.value = null;
    modalOpen.value = false;
    resetImageErrors();
    const pending = pendingOpen.value;
    pendingOpen.value = null;
    if (pending?.path && pending?.rootId === props.currentRoot?.id) {
      currentPath.value = pending.path;
    }
    loadList({ reset: true });
  },
  { immediate: true }
);

watch(
  [() => props.navState, () => props.currentRoot],
  ([value, current]) => {
    if (!current || !value || typeof value.path !== 'string') {
      return;
    }
    if (value.rootId && value.rootId !== current.id) {
      return;
    }
    if (value.token && value.token === lastNavToken.value) {
      return;
    }
    lastNavToken.value = value.token || Date.now();
    const nextPath = value.path;
    if (currentPath.value === nextPath) {
      return;
    }
    currentPath.value = nextPath;
    searchQuery.value = '';
    loadList({ reset: true });
  },
  { deep: true }
);

watch(
  () => props.pageSize,
  () => {
    if (isSearchMode.value) {
      runSearch({ reset: true });
    } else {
      loadList({ reset: true });
    }
  }
);

watch(modalOpen, (value) => {
  document.body.style.overflow = value ? 'hidden' : '';
});

onMounted(() => {
  window.addEventListener('keydown', handleKey);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKey);
  document.body.style.overflow = '';
});

function handleKey(event) {
  if (!modalOpen.value) {
    return;
  }
  if (event.key === 'Escape') {
    closeModal();
  } else if (event.key === 'ArrowRight') {
    navigateModal(1);
  } else if (event.key === 'ArrowLeft') {
    navigateModal(-1);
  } else if (event.key === '+' || event.key === '=') {
    zoomIn();
  } else if (event.key === '-') {
    zoomOut();
  }
}
</script>

<template>
  <section class="layout" :class="{ 'sidebar-open': sidebarOpen }">
    <aside class="sidebar">
      <h3>Storage Roots</h3>
      <button
        v-for="root in roots"
        :key="root.id"
        class="root-btn"
        :class="{ active: currentRoot?.id === root.id }"
        @click="handleRootSelect(root)"
      >
        {{ root.name }}
      </button>
    </aside>
    <div class="sidebar-scrim" @click="closeSidebar"></div>

    <main class="browser">
      <div class="toolbar">
        <div class="toolbar-title">
          <nav class="breadcrumbs" v-if="breadcrumbs.length">
            <button
              v-for="(crumb, index) in breadcrumbs"
              :key="crumb.path || index"
              @click="goToCrumb(crumb)"
              @contextmenu.prevent="openBreadcrumbMenu($event, crumb, index)"
            >
              {{ crumb.name }}
              <span v-if="index < breadcrumbs.length - 1">/</span>
            </button>
          </nav>
          <span class="meta" v-if="isSearchMode">Search - {{ searchResults.length }} results</span>
        </div>
        <div class="toolbar-actions">
          <button class="icon-btn sidebar-toggle" @click="toggleSidebar" aria-label="Toggle sidebar">
            <i class="fa-solid fa-bars"></i>
          </button>
          <button
            class="icon-btn"
            @click="refreshPath(currentPath)"
            :disabled="!currentRoot"
            aria-label="Refresh this folder"
          >
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <input
            class="search"
            type="search"
            placeholder="Search files"
            v-model="searchQuery"
          />
          <label class="search-scope">
            <input type="checkbox" v-model="searchAllRoots" />
            <span>All roots</span>
          </label>
          <button class="action-btn secondary" @click="downloadZip" :disabled="!selectionCount">
            Download ({{ selectionCount }})
          </button>
          <div class="view-toggle">
            <button :class="{ active: viewMode === 'list' }" @click="viewMode = 'list'">
              List
            </button>
            <button :class="{ active: viewMode === 'grid' }" @click="viewMode = 'grid'">
              Grid
            </button>
          </div>
        </div>
      </div>

      <div v-if="loading && !displayItems.length" class="empty-state">Loading files...</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else-if="!displayItems.length" class="empty-state">
        Drop files into the root folder to populate this view.
      </div>

      <div v-else-if="viewMode === 'list'">
        <div class="list-header">
          <div>Name</div>
          <div>Size</div>
          <div>Modified</div>
          <div>Type</div>
        </div>
        <div
          v-for="(item, index) in displayItems"
          :key="itemKey(item)"
          class="list-row"
          :class="{ selected: isSelected(item) }"
          @click="handleItemClick(item, $event)"
          @contextmenu.prevent="openItemMenu($event, item)"
          :style="{ animationDelay: `${index * 20}ms` }"
          >
            <div class="name-cell">
              <span class="icon"><i :class="iconClass(item)"></i></span>
              <div class="name-stack">
                <strong>{{ item.name }}</strong>
                <div v-if="isSearchMode" class="item-path">{{ item.path }}</div>
              </div>
            </div>
          <div>{{ item.isDir ? '--' : formatSize(item.size) }}</div>
          <div>{{ formatDate(item.mtime) }}</div>
          <div>{{ item.isDir ? 'Folder' : item.ext?.replace('.', '') || 'File' }}</div>
        </div>
      </div>

      <div v-else class="grid">
        <div
          v-for="item in displayItems"
          :key="itemKey(item)"
          class="grid-card"
          :class="{ selected: isSelected(item) }"
          @click="handleItemClick(item, $event)"
          @contextmenu.prevent="openItemMenu($event, item)"
          >
            <div class="grid-thumb">
              <img
                v-if="isImage(item) && !hasImageError(item, 'thumb')"
                :src="previewUrl(itemRootId(item), item.path)"
                :alt="item.name"
                @error="markImageError(item, 'thumb')"
              />
              <div v-else-if="isImage(item)" class="media-fallback compact">
                <i class="fa-solid fa-file-circle-xmark"></i>
                <span>{{ item.ext?.replace('.', '').toUpperCase() || 'FILE' }}</span>
              </div>
              <span v-else class="icon"><i :class="iconClass(item)"></i></span>
            </div>
            <strong>{{ item.name }}</strong>
            <div v-if="isSearchMode" class="item-path">{{ item.path }}</div>
          <div class="meta">{{ item.isDir ? 'Folder' : formatSize(item.size) }}</div>
        </div>
      </div>

      <div v-if="hasMore" class="empty-state">
        <button class="action-btn secondary" @click="loadMore">Load more</button>
      </div>
      <div ref="sentinel" class="scroll-sentinel"></div>
    </main>

    <aside class="preview">
      <h3>Preview</h3>
      <div v-if="activeItem" class="preview-media">
        <img
          v-if="isImage(activeItem) && !hasImageError(activeItem, 'panel')"
          :src="previewUrl(itemRootId(activeItem), activeItem.path)"
          :alt="activeItem.name"
          @error="markImageError(activeItem, 'panel')"
        />
        <div v-else-if="isImage(activeItem)" class="media-fallback">
          <i class="fa-solid fa-file-circle-xmark"></i>
          <div>Preview unavailable</div>
          <div class="media-fallback-meta">
            {{ activeItem.ext?.replace('.', '').toUpperCase() || 'FILE' }}
          </div>
        </div>
        <video
          v-else-if="isVideo(activeItem)"
          :src="fileUrl(itemRootId(activeItem), activeItem.path)"
          controls
        />
        <div v-else class="icon"><i :class="iconClass(activeItem)"></i></div>
      </div>
      <div v-else class="preview-media">Select a file to preview</div>
      <div v-if="activeItem" class="meta">
        <div>{{ activeItem.name }}</div>
        <div>{{ activeItem.path }}</div>
        <div>{{ activeItem.isDir ? 'Folder' : formatSize(activeItem.size) }}</div>
        <div>{{ formatDate(activeItem.mtime) }}</div>
      </div>
      <a
        v-if="activeItem && !activeItem.isDir"
        class="action-btn"
        :href="downloadUrl(itemRootId(activeItem), activeItem.path)"
      >
        Download File
      </a>
    </aside>
  </section>

  <div v-if="modalOpen && modalItem" class="modal-overlay photo-modal" @click.self="closeModal">
    <div class="photo-modal-controls">
      <button v-if="isImage(modalItem)" class="icon-btn" @click="zoomOut" aria-label="Zoom out">
        <i class="fa-solid fa-magnifying-glass-minus"></i>
      </button>
      <button v-if="isImage(modalItem)" class="icon-btn" @click="zoomIn" aria-label="Zoom in">
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
      <MiniPlayer
        v-else-if="isAudio(modalItem)"
        :tracks="audioQueue"
        :selected-track="modalAudioTrack"
        :root-id="itemRootId(modalItem)"
        :auto-play="true"
        :auto-play-on-mount="true"
        variant="embedded"
        @select="handleModalPlayerSelect"
      />
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

  <div
    v-if="breadcrumbMenu.open"
    class="context-menu"
    :style="{ top: `${breadcrumbMenu.y}px`, left: `${breadcrumbMenu.x}px` }"
  >
    <button class="context-menu-item" @click="refreshPath(breadcrumbMenu.path)">
      <i class="fa-solid fa-rotate-right"></i>
      Refresh this folder
    </button>
    <button class="context-menu-item" @click="forceRehashPath(breadcrumbMenu.path)">
      <i class="fa-solid fa-bolt"></i>
      Force full rehash
    </button>
  </div>

  <div
    v-if="itemMenu.open"
    class="context-menu"
    :style="{ top: `${itemMenu.y}px`, left: `${itemMenu.x}px` }"
  >
    <button
      class="context-menu-item"
      @click="handleItemDownload(itemMenu.item)"
    >
      <i class="fa-solid fa-download"></i>
      Download
    </button>
    <button
      v-if="itemMenu.item && isAudio(itemMenu.item)"
      class="context-menu-item"
      @click="handleOpenInMusic(itemMenu.item)"
    >
      <i class="fa-solid fa-music"></i>
      Open in Music
    </button>
    <button
      v-if="itemMenu.item && isImage(itemMenu.item)"
      class="context-menu-item"
      @click="handleOpenInPhotos(itemMenu.item)"
    >
      <i class="fa-solid fa-image"></i>
      Open in Photos
    </button>
    <button
      v-if="selectionCount > 1"
      class="context-menu-item"
      @click="handleDownloadSelection"
    >
      <i class="fa-solid fa-file-zipper"></i>
      Download selection ({{ selectionCount }})
    </button>
  </div>
</template>
