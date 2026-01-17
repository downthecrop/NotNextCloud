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

const currentPath = ref('');
const items = ref([]);
const listTotal = ref(0);
const listOffset = ref(0);
const searchQuery = ref('');
const searchResults = ref([]);
const searchTotal = ref(0);
const searchOffset = ref(0);
const viewMode = ref('list');
const loading = ref(false);
const error = ref('');
const selectedPaths = ref([]);
const modalOpen = ref(false);
const modalItem = ref(null);
const zoomLevel = ref(1);
const sentinel = ref(null);
let observer = null;

const rootId = computed(() => props.currentRoot?.id || '');
const isSearchMode = computed(() => Boolean(searchQuery.value.trim()));
const displayItems = computed(() => (isSearchMode.value ? searchResults.value : items.value));
const selectionCount = computed(() => selectedPaths.value.length);
const hasMore = computed(() => {
  if (isSearchMode.value) {
    return searchResults.value.length < searchTotal.value;
  }
  return items.value.length < listTotal.value;
});

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
    displayItems.value.find((item) => item.path === needle) ||
    items.value.find((item) => item.path === needle) ||
    searchResults.value.find((item) => item.path === needle) ||
    null
  );
});

function isImage(item) {
  return item?.mime?.startsWith('image/');
}

function isVideo(item) {
  return item?.mime?.startsWith('video/');
}

function isAudio(item) {
  return item?.mime?.startsWith('audio/');
}

function isMedia(item) {
  return isImage(item) || isVideo(item) || isAudio(item);
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

async function loadList({ reset = true } = {}) {
  if (!props.currentRoot) {
    return;
  }
  if (reset) {
    listOffset.value = 0;
    listTotal.value = 0;
    items.value = [];
    selectedPaths.value = [];
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
    selectedPaths.value = [];
  }
  loading.value = true;
  try {
    const offset = reset ? 0 : searchOffset.value;
    const res = await apiFetch(
      `/api/search?root=${encodeURIComponent(props.currentRoot.id)}` +
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
    currentPath.value = item.path;
    searchQuery.value = '';
    await loadList({ reset: true });
    return;
  }

  if (isSearchMode.value) {
    const parts = item.path.split('/');
    parts.pop();
    currentPath.value = parts.join('/');
    searchQuery.value = '';
    await loadList({ reset: true });
    selectedPaths.value = [item.path];
  }
}

function openModal(item) {
  modalItem.value = item;
  zoomLevel.value = 1;
  modalOpen.value = true;
}

function closeModal() {
  modalOpen.value = false;
}

function zoomIn() {
  zoomLevel.value = Math.min(3, zoomLevel.value + 0.25);
}

function zoomOut() {
  zoomLevel.value = Math.max(1, zoomLevel.value - 0.25);
}

function toggleSelection(item, event) {
  const path = item.path;
  if (event?.metaKey || event?.ctrlKey) {
    if (selectedPaths.value.includes(path)) {
      selectedPaths.value = selectedPaths.value.filter((itemPath) => itemPath !== path);
    } else {
      selectedPaths.value = [...selectedPaths.value, path];
    }
    return;
  }
  selectedPaths.value = [path];
}

async function handleItemClick(item, event) {
  if (item.isDir && !(event?.metaKey || event?.ctrlKey)) {
    await openItem(item);
    return;
  }
  if (!item.isDir && !event?.metaKey && !event?.ctrlKey && isMedia(item)) {
    toggleSelection(item, event);
    openModal(item);
    return;
  }
  toggleSelection(item, event);
}

function goToCrumb(crumb) {
  currentPath.value = crumb.path;
  searchQuery.value = '';
  loadList({ reset: true });
}

async function downloadZip() {
  if (!selectionCount.value || !props.currentRoot) {
    return;
  }
  const res = await apiFetch('/api/zip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      root: props.currentRoot.id,
      paths: selectedPaths.value,
    }),
  });
  if (!res.ok) {
    return;
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'files.zip';
  link.click();
  URL.revokeObjectURL(url);
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

let searchTimer = null;
watch(searchQuery, () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch({ reset: true }), 250);
});

watch(
  () => props.currentRoot,
  () => {
    currentPath.value = '';
    searchQuery.value = '';
    modalItem.value = null;
    modalOpen.value = false;
    loadList({ reset: true });
  },
  { immediate: true }
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
  observer = new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting) {
      loadMore();
    }
  });
  if (sentinel.value) {
    observer.observe(sentinel.value);
  }
  window.addEventListener('keydown', handleKey);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKey);
  document.body.style.overflow = '';
});

watch(sentinel, (value) => {
  if (!observer || !value) {
    return;
  }
  observer.observe(value);
});

function handleKey(event) {
  if (!modalOpen.value) {
    return;
  }
  if (event.key === 'Escape') {
    closeModal();
  } else if (event.key === '+' || event.key === '=') {
    zoomIn();
  } else if (event.key === '-') {
    zoomOut();
  }
}
</script>

<template>
  <section class="layout">
    <aside class="sidebar">
      <h3>Storage Roots</h3>
      <button
        v-for="root in roots"
        :key="root.id"
        class="root-btn"
        :class="{ active: currentRoot?.id === root.id }"
        @click="onSelectRoot(root)"
      >
        {{ root.name }}
      </button>
    </aside>

    <main class="browser">
      <div class="toolbar">
        <div class="toolbar-title">
          <nav class="breadcrumbs" v-if="breadcrumbs.length">
            <button
              v-for="(crumb, index) in breadcrumbs"
              :key="crumb.path || index"
              @click="goToCrumb(crumb)"
            >
              {{ crumb.name }}
              <span v-if="index < breadcrumbs.length - 1">/</span>
            </button>
          </nav>
          <span class="meta" v-if="isSearchMode">Search - {{ searchResults.length }} results</span>
        </div>
        <div class="toolbar-actions">
          <input
            class="search"
            type="search"
            placeholder="Search files"
            v-model="searchQuery"
          />
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
          :key="item.path"
          class="list-row"
          :class="{ selected: selectedPaths.includes(item.path) }"
            @click="handleItemClick(item, $event)"
            :style="{ animationDelay: `${index * 20}ms` }"
          >
            <div class="name-cell">
              <span class="icon"><i :class="iconClass(item)"></i></span>
              <strong>{{ item.name }}</strong>
            </div>
          <div>{{ item.isDir ? '--' : formatSize(item.size) }}</div>
          <div>{{ formatDate(item.mtime) }}</div>
          <div>{{ item.isDir ? 'Folder' : item.ext?.replace('.', '') || 'File' }}</div>
        </div>
      </div>

      <div v-else class="grid">
        <div
          v-for="item in displayItems"
          :key="item.path"
          class="grid-card"
          :class="{ selected: selectedPaths.includes(item.path) }"
            @click="handleItemClick(item, $event)"
          >
            <div class="grid-thumb">
              <img v-if="isImage(item)" :src="previewUrl(rootId, item.path)" :alt="item.name" />
              <span v-else class="icon"><i :class="iconClass(item)"></i></span>
            </div>
            <strong>{{ item.name }}</strong>
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
          v-if="isImage(activeItem)"
          :src="previewUrl(rootId, activeItem.path)"
          :alt="activeItem.name"
        />
        <video
          v-else-if="isVideo(activeItem)"
          :src="fileUrl(rootId, activeItem.path)"
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
        :href="fileUrl(rootId, activeItem.path)"
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
      <video v-else-if="isVideo(modalItem)" :src="fileUrl(rootId, modalItem.path)" controls></video>
      <audio v-else-if="isAudio(modalItem)" :src="fileUrl(rootId, modalItem.path)" controls></audio>
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
