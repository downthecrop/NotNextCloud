<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
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
  onSelectRoot: {
    type: Function,
    required: true,
  },
});

const { apiFetch, fileUrl, previewUrl } = useApi();

const items = ref([]);
const total = ref(0);
const offset = ref(0);
const searchQuery = ref('');
const searchResults = ref([]);
const searchTotal = ref(0);
const searchOffset = ref(0);
const loading = ref(false);
const error = ref('');
const selectedItem = ref(null);
const modalItem = ref(null);
const modalOpen = ref(false);
const zoomLevel = ref(1);
const albums = ref([]);
const selectedAlbumId = ref(null);
const albumCounter = ref(1);
const photoPins = ref([]);
const activePin = ref(null);
const contextMenu = ref({ open: false, x: 0, y: 0, item: null });
const sentinel = ref(null);
let observer = null;

const rootId = computed(() => props.currentRoot?.id || '');
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const displayItems = computed(() => (isSearchMode.value ? searchResults.value : items.value));
const selectedAlbum = computed(
  () => albums.value.find((album) => album.id === selectedAlbumId.value) || null
);
const isAlbumDetail = computed(() => Boolean(selectedAlbum.value));
const albumItems = computed(() => selectedAlbum.value?.items || []);
const modalItems = computed(() => (isAlbumDetail.value ? albumItems.value : displayItems.value));
const activePinPath = computed(() => activePin.value?.path || '');
const hasMore = computed(() => {
  if (isAlbumDetail.value) {
    return false;
  }
  if (isSearchMode.value) {
    return searchResults.value.length < searchTotal.value;
  }
  return items.value.length < total.value;
});

const timelineGroups = computed(() => {
  const groups = [];
  const formatter = new Intl.DateTimeFormat('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  let currentLabel = '';
  for (const item of displayItems.value) {
    const label = formatter.format(new Date(item.mtime));
    if (!groups.length || label !== currentLabel) {
      groups.push({ label, items: [] });
      currentLabel = label;
    }
    groups[groups.length - 1].items.push(item);
  }
  return groups;
});

function isImage(item) {
  return item?.mime?.startsWith('image/');
}

function isVideo(item) {
  return item?.mime?.startsWith('video/');
}

function tileClass() {
  return 'tile';
}

function formatSize(bytes) {
  if (!bytes && bytes !== 0) {
    return '';
  }
  if (bytes === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const size = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, size);
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[size]}`;
}

function formatDate(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  return date.toLocaleString();
}

function openModal(item) {
  selectedItem.value = item;
  modalItem.value = item;
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
  selectedItem.value = item;
  zoomLevel.value = 1;
}

function navigateModal(delta) {
  const list = modalItems.value;
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

function handleKey(event) {
  if (!modalOpen.value) {
    return;
  }
  if (event.key === 'ArrowRight') {
    navigateModal(1);
  } else if (event.key === 'ArrowLeft') {
    navigateModal(-1);
  } else if (event.key === 'Escape') {
    closeModal();
  } else if (event.key === '+' || event.key === '=') {
    zoomIn();
  } else if (event.key === '-') {
    zoomOut();
  }
}

function persistAlbums() {
  localStorage.setItem('localCloudPhotoAlbums', JSON.stringify(albums.value));
  localStorage.setItem('localCloudPhotoAlbumCounter', String(albumCounter.value));
}

function loadAlbums() {
  try {
    const stored = localStorage.getItem('localCloudPhotoAlbums');
    albums.value = stored ? JSON.parse(stored) : [];
  } catch {
    albums.value = [];
  }
  const counter = parseInt(localStorage.getItem('localCloudPhotoAlbumCounter') || '1', 10);
  albumCounter.value = Number.isFinite(counter) && counter > 0 ? counter : 1;
}

function ensureDraftAlbum() {
  let draft = albums.value.find((album) => album.isDraft);
  if (!draft) {
    const id = `album-${Date.now()}`;
    draft = {
      id,
      name: `New Album #${albumCounter.value}`,
      items: [],
      isDraft: true,
    };
    albumCounter.value += 1;
    albums.value = [draft, ...albums.value];
  }
  return draft;
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

function persistPins() {
  localStorage.setItem('localCloudPhotoPins', JSON.stringify(photoPins.value));
}

function loadPins() {
  try {
    const stored = localStorage.getItem('localCloudPhotoPins');
    photoPins.value = stored ? JSON.parse(stored) : [];
  } catch {
    photoPins.value = [];
  }
}

function pinLabel(pathValue) {
  if (!pathValue) {
    return 'Root';
  }
  const parts = pathValue.split('/');
  return parts[parts.length - 1] || pathValue;
}

function addPinForItem(item) {
  if (!item?.path) {
    return;
  }
  const parts = item.path.split('/');
  parts.pop();
  const pathValue = parts.join('/');
  if (photoPins.value.some((pin) => pin.path === pathValue)) {
    closeContextMenu();
    return;
  }
  const nextPin = {
    id: `pin-${Date.now()}`,
    path: pathValue,
    label: pinLabel(pathValue),
  };
  photoPins.value = [...photoPins.value, nextPin];
  persistPins();
  closeContextMenu();
}

function selectPin(pin) {
  activePin.value = pin;
}

function clearPin() {
  activePin.value = null;
}

function closeContextMenu() {
  contextMenu.value = { open: false, x: 0, y: 0, item: null };
}

function openContextMenu(event, item) {
  contextMenu.value = {
    open: true,
    x: event.clientX,
    y: event.clientY,
    item,
  };
}

async function loadPhotos({ reset = true } = {}) {
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
        `&type=photos&limit=${props.pageSize}&offset=${pageOffset}${pathPrefix}`
    );
    if (!res.ok) {
      error.value = 'Failed to load photos';
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    items.value = reset ? newItems : [...items.value, ...newItems];
    total.value = data.total || 0;
    offset.value = pageOffset + newItems.length;
  } catch (err) {
    error.value = 'Failed to load photos';
  } finally {
    loading.value = false;
  }
}

async function runSearch({ reset = true } = {}) {
  if (!props.currentRoot) {
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
        `&type=photos&q=${encodeURIComponent(query)}` +
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

let searchTimer = null;
watch(searchQuery, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch({ reset: true }), 250);
});

watch(activePin, () => {
  searchQuery.value = '';
  loadPhotos({ reset: true });
});

watch(
  () => props.currentRoot,
  () => {
    searchQuery.value = '';
    selectedItem.value = null;
    modalItem.value = null;
    modalOpen.value = false;
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

watch(modalOpen, (value) => {
  document.body.style.overflow = value ? 'hidden' : '';
});

onMounted(() => {
  loadAlbums();
  loadPins();
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMore();
    }
  });
  if (sentinel.value) {
    observer.observe(sentinel.value);
  }
  window.addEventListener('keydown', handleKey);
  window.addEventListener('click', closeContextMenu);
  window.addEventListener('scroll', closeContextMenu, true);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKey);
  window.removeEventListener('click', closeContextMenu);
  window.removeEventListener('scroll', closeContextMenu, true);
  document.body.style.overflow = '';
});

watch(sentinel, (value) => {
  if (!observer || !value) {
    return;
  }
  observer.observe(value);
});
</script>

<template>
  <section class="layout layout-wide photos-layout">
    <aside class="sidebar">
      <h3>Photos</h3>
      <div class="sidebar-section">
        <div class="sidebar-title">Albums</div>
        <button class="sidebar-item" :class="{ active: !selectedAlbumId }" @click="clearAlbumSelection">
          <span class="icon"><i class="fa-regular fa-images"></i></span>
          All photos
        </button>
        <button class="sidebar-item" @click="selectAlbum(ensureDraftAlbum())">
          <span class="icon"><i class="fa-solid fa-plus"></i></span>
          Create album
        </button>
        <button
          v-for="album in albums"
          :key="album.id"
          class="sidebar-item"
          :class="{ active: selectedAlbumId === album.id }"
          @click="selectAlbum(album)"
        >
          <span class="icon"><i class="fa-solid fa-photo-film"></i></span>
          <span class="sidebar-label">{{ album.name }}</span>
          <span class="sidebar-count">{{ album.items.length }}</span>
        </button>
        <div v-if="!albums.length" class="sidebar-hint">Add photos to start an album.</div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-title">Pinned</div>
        <button class="sidebar-item" :class="{ active: !activePin }" @click="clearPin">
          <span class="icon"><i class="fa-regular fa-bookmark"></i></span>
          All locations
        </button>
        <button
          v-for="pin in photoPins"
          :key="pin.id"
          class="sidebar-item"
          :class="{ active: activePin?.id === pin.id }"
          @click="selectPin(pin)"
        >
          <span class="icon"><i class="fa-solid fa-location-dot"></i></span>
          <span class="sidebar-label">{{ pin.label }}</span>
        </button>
        <div v-if="!photoPins.length" class="sidebar-hint">Right-click a photo to pin.</div>
      </div>
    </aside>

    <main class="browser photos-browser">
      <div class="toolbar">
        <div class="toolbar-title">
          <div class="toolbar-line">
            <button v-if="selectedAlbum" class="action-btn secondary" @click="clearAlbumSelection">
              <i class="fa-solid fa-arrow-left"></i>
              Back
            </button>
            <strong>{{ selectedAlbum ? selectedAlbum.name : 'Photos' }}</strong>
            <span class="meta" v-if="selectedAlbum"> - {{ albumItems.length }} items</span>
            <span class="meta" v-else>
              - {{ displayItems.length }} of {{ isSearchMode ? searchTotal : total }}
            </span>
          </div>
        </div>
        <div class="toolbar-actions" v-if="!selectedAlbum">
          <input
            class="search"
            type="search"
            placeholder="Search photos and videos"
            v-model="searchQuery"
          />
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
              :key="item.path"
              :class="tileClass(index)"
              @click="openModal(item)"
              @contextmenu.prevent="openContextMenu($event, item)"
            >
              <img
                v-if="isImage(item)"
                :src="previewUrl(rootId, item.path)"
                :alt="item.name"
                loading="lazy"
              />
              <video
                v-else-if="isVideo(item)"
                :src="fileUrl(rootId, item.path)"
                muted
                playsinline
                preload="metadata"
              ></video>
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
            <button class="action-btn secondary" @click="clearAlbum">
              <i class="fa-solid fa-trash"></i>
              Clear
            </button>
          </div>
        </div>
        <div v-if="!albumItems.length" class="empty-state">This album is empty.</div>
        <div v-else class="photo-album-grid">
          <div
            v-for="(item, index) in albumItems"
            :key="item.path"
            :class="tileClass(index)"
            @click="openModal(item)"
            @contextmenu.prevent="openContextMenu($event, item)"
          >
            <img
              v-if="isImage(item)"
              :src="previewUrl(rootId, item.path)"
              :alt="item.name"
              loading="lazy"
            />
            <video
              v-else-if="isVideo(item)"
              :src="fileUrl(rootId, item.path)"
              muted
              playsinline
              preload="metadata"
            ></video>
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
  </div>

  <div v-if="modalOpen && modalItem" class="modal-overlay photo-modal" @click.self="closeModal">
    <div class="photo-modal-controls">
      <button class="icon-btn" @click="zoomOut" aria-label="Zoom out">
        <i class="fa-solid fa-magnifying-glass-minus"></i>
      </button>
      <button class="icon-btn" @click="zoomIn" aria-label="Zoom in">
        <i class="fa-solid fa-magnifying-glass-plus"></i>
      </button>
      <a class="icon-btn" :href="fileUrl(rootId, modalItem.path)" aria-label="Download">
        <i class="fa-solid fa-download"></i>
      </a>
      <button class="icon-btn" @click="closeModal" aria-label="Close">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>

    <div class="photo-modal-stage">
      <img
        v-if="isImage(modalItem)"
        :src="fileUrl(rootId, modalItem.path)"
        :alt="modalItem.name"
        :style="{ transform: `scale(${zoomLevel})` }"
      />
      <video
        v-else-if="isVideo(modalItem)"
        :src="fileUrl(rootId, modalItem.path)"
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
