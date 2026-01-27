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
  uploadEnabled: {
    type: Boolean,
    default: true,
  },
  uploadOverwrite: {
    type: Boolean,
    default: false,
  },
  uploadChunkBytes: {
    type: Number,
    default: 8 * 1024 * 1024,
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

const { apiFetch, fileUrl, previewUrl, downloadUrl, trashFileUrl } = useApi();
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
const fileInput = ref(null);
const dragActive = ref(false);
const uploading = ref(false);
const uploadMessage = ref('');
const uploadErrors = ref([]);
const uploadProgress = ref({ file: '', percent: 0 });
const isTrashView = ref(false);
const trashItems = ref([]);
const trashTotal = ref(0);
const trashOffset = ref(0);
const needsFilesRefresh = ref(false);
const dragDepth = ref(0);
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
  if (isTrashView.value) {
    return `trash:${item?.trashId || item?.id || item?.path || ''}`;
  }
  return buildItemKey(item, rootId.value);
}
const { hasImageError, markImageError, resetImageErrors } = useImageErrors({
  getKey: (item) => `${itemRootId(item)}:${item?.path || ''}`,
});
const isSearchMode = computed(() => !isTrashView.value && Boolean(searchQuery.value.trim()));
const displayItems = computed(() => {
  if (isTrashView.value) {
    return trashItems.value;
  }
  return isSearchMode.value ? searchResults.value : items.value;
});
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
  if (isTrashView.value) {
    return trashItems.value.length < trashTotal.value;
  }
  if (isSearchMode.value) {
    return searchResults.value.length < searchTotal.value;
  }
  return items.value.length < listTotal.value;
});
const audioQueue = computed(() =>
  isTrashView.value ? [] : displayItems.value.filter((item) => isAudio(item))
);
const selectedAudioTrack = computed(() =>
  activeItem.value && isAudio(activeItem.value) ? activeItem.value : null
);
const modalAudioTrack = computed(() =>
  modalItem.value && isAudio(modalItem.value) ? modalItem.value : null
);

const breadcrumbs = computed(() => {
  if (isTrashView.value) {
    return [{ name: 'Recycle Bin', path: '' }];
  }
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
  if (isSearchMode.value) {
    await runSearch({ reset: true });
  } else {
    await loadList({ reset: true });
  }
  closeBreadcrumbMenu();
}

async function forceRehashPath(pathValue) {
  await scheduleScan('rehash', pathValue);
  if (isSearchMode.value) {
    await runSearch({ reset: true });
  } else {
    await loadList({ reset: true });
  }
  closeBreadcrumbMenu();
}

function openBreadcrumbMenu(event, crumb, index) {
  if (isTrashView.value) {
    return;
  }
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
  if (isTrashView.value) {
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

async function moveItemsToTrash(targetItems) {
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
    await apiFetch('/api/delete', {
      method: 'POST',
      body: JSON.stringify({ root: targetRootId, paths }),
    });
  }
}

async function deleteSelection() {
  if (!selectionCount.value) {
    return;
  }
  if (!confirm(`Move ${selectionCount.value} item(s) to Recycle Bin?`)) {
    return;
  }
  await moveItemsToTrash(selectedItems.value);
  clearSelection();
  await loadList({ reset: true });
  closeItemMenu();
}

async function restoreSelection() {
  if (!selectionCount.value) {
    return;
  }
  const ids = selectedItems.value.map((item) => item.trashId).filter(Boolean);
  if (!ids.length) {
    return;
  }
  await apiFetch('/api/trash/restore', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  clearSelection();
  await loadTrash({ reset: true });
  needsFilesRefresh.value = true;
  closeItemMenu();
}

async function deleteTrashSelection() {
  if (!selectionCount.value) {
    return;
  }
  if (!confirm(`Permanently delete ${selectionCount.value} item(s)?`)) {
    return;
  }
  const ids = selectedItems.value.map((item) => item.trashId).filter(Boolean);
  if (!ids.length) {
    return;
  }
  await apiFetch('/api/trash/delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
  clearSelection();
  await loadTrash({ reset: true });
  needsFilesRefresh.value = true;
  closeItemMenu();
}

async function clearTrash() {
  if (!confirm('Permanently delete all items in Recycle Bin?')) {
    return;
  }
  await apiFetch('/api/trash/clear', { method: 'POST', body: JSON.stringify({ root: '__all__' }) });
  clearSelection();
  await loadTrash({ reset: true });
  needsFilesRefresh.value = true;
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
  const wasTrash = isTrashView.value;
  isTrashView.value = false;
  props.onSelectRoot(root);
  if (wasTrash) {
    loadList({ reset: true });
    needsFilesRefresh.value = false;
  } else if (needsFilesRefresh.value) {
    loadList({ reset: true });
    needsFilesRefresh.value = false;
  }
  closeSidebar();
}

async function openTrash() {
  isTrashView.value = true;
  viewMode.value = 'list';
  searchQuery.value = '';
  modalItem.value = null;
  modalOpen.value = false;
  currentPath.value = '';
  uploadMessage.value = '';
  uploadErrors.value = [];
  uploadProgress.value = { file: '', percent: 0 };
  clearSelection();
  await loadTrash({ reset: true });
  closeSidebar();
}

function openFilePicker() {
  if (!props.currentRoot || uploading.value || !props.uploadEnabled) {
    return;
  }
  fileInput.value?.click();
}

function handleFileSelect(event) {
  const files = Array.from(event.target?.files || []);
  if (!files.length) {
    return;
  }
  event.target.value = '';
  uploadFiles(files);
}

function handleDragOver(event) {
  if (!props.currentRoot || uploading.value || !props.uploadEnabled) {
    return;
  }
  if (!event.dataTransfer?.types?.includes('Files')) {
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  dragActive.value = true;
}

function handleDragEnter(event) {
  if (!props.currentRoot || uploading.value || !props.uploadEnabled) {
    return;
  }
  if (!event.dataTransfer?.types?.includes('Files')) {
    return;
  }
  event.preventDefault();
  dragDepth.value += 1;
  dragActive.value = true;
}

function handleDragLeave(event) {
  if (!event.dataTransfer?.types?.includes('Files')) {
    return;
  }
  event.preventDefault();
  dragDepth.value = Math.max(0, dragDepth.value - 1);
  if (dragDepth.value === 0) {
    dragActive.value = false;
  }
}

function handleDrop(event) {
  if (!props.currentRoot || uploading.value || !props.uploadEnabled) {
    return;
  }
  if (!event.dataTransfer?.types?.includes('Files')) {
    return;
  }
  event.preventDefault();
  dragActive.value = false;
  dragDepth.value = 0;
  const files = Array.from(event.dataTransfer?.files || []);
  if (!files.length) {
    return;
  }
  uploadFiles(files);
}

async function uploadFiles(files) {
  if (!props.currentRoot || !files.length || !props.uploadEnabled) {
    return;
  }
  uploading.value = true;
  uploadMessage.value = 'Uploading...';
  uploadErrors.value = [];
  uploadProgress.value = { file: '', percent: 0 };
  const chunkBytes = Math.max(1024 * 1024, props.uploadChunkBytes || 8 * 1024 * 1024);
  let stored = 0;
  let skipped = 0;
  const errors = [];
  try {
    for (const file of files) {
      const name = file.webkitRelativePath || file.name;
      if (!name) {
        skipped += 1;
        errors.push({ file: '(unknown)', error: 'Missing filename' });
        continue;
      }
      const getStatus = async (overwriteFlag) => {
        const statusRes = await apiFetch(
          `/api/upload/status?root=${encodeURIComponent(props.currentRoot.id)}` +
            `&path=${encodeURIComponent(currentPath.value)}` +
            `&file=${encodeURIComponent(name)}` +
            `&size=${file.size}` +
            `&overwrite=${overwriteFlag ? '1' : '0'}`
        );
        if (statusRes.status === 409) {
          const data = await statusRes.json().catch(() => null);
          if (data?.status === 'exists' || /exists/i.test(data?.error || '')) {
            return { status: 'exists' };
          }
          throw new Error(data?.error || 'Upload failed');
        }
        if (!statusRes.ok) {
          let message = 'Upload failed.';
          try {
            const data = await statusRes.json();
            if (data?.error) {
              message = data.error;
            }
          } catch {
            message = 'Upload failed.';
          }
          throw new Error(message);
        }
        return statusRes.json();
      };
      try {
        uploadProgress.value = { file: name, percent: 0 };
        uploadMessage.value = `Preparing ${name}...`;
        let overwriteFlag = props.uploadOverwrite;
        let status = await getStatus(overwriteFlag);
        if (status?.status === 'exists' && !overwriteFlag) {
          const confirmOverwrite = confirm(`"${name}" already exists. Overwrite it?`);
          if (!confirmOverwrite) {
            skipped += 1;
            errors.push({ file: name, error: 'File already exists' });
            continue;
          }
          overwriteFlag = true;
          status = await getStatus(true);
        }
        if (status?.status === 'complete') {
          stored += 1;
          uploadProgress.value = { file: name, percent: 100 };
          continue;
        }

        let offset = Number.isFinite(status?.offset) ? status.offset : 0;
        if (offset < 0 || offset > file.size) {
          offset = 0;
        }
        if (offset > 0) {
          uploadMessage.value = `Resuming ${name}...`;
        }

        while (offset < file.size) {
          const chunk = file.slice(offset, Math.min(offset + chunkBytes, file.size));
          const percent = Math.min(100, Math.floor((offset / file.size) * 100));
          uploadProgress.value = { file: name, percent };
          uploadMessage.value = `Uploading ${name} (${percent}%)`;
          const chunkRes = await apiFetch(
            `/api/upload/chunk?root=${encodeURIComponent(props.currentRoot.id)}` +
              `&path=${encodeURIComponent(currentPath.value)}` +
              `&file=${encodeURIComponent(name)}` +
              `&size=${file.size}` +
              `&offset=${offset}` +
              `&overwrite=${overwriteFlag ? '1' : '0'}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/octet-stream' },
              body: chunk,
            }
          );
          if (chunkRes.status === 409) {
            const data = await chunkRes.json().catch(() => null);
            const expected = Number.isFinite(data?.expectedOffset) ? data.expectedOffset : offset;
            offset = expected;
            continue;
          }
          if (!chunkRes.ok) {
            let message = 'Upload failed.';
            try {
              const data = await chunkRes.json();
              if (data?.error) {
                message = data.error;
              }
            } catch {
              message = 'Upload failed.';
            }
            throw new Error(message);
          }
          const data = await chunkRes.json();
          offset = Number.isFinite(data?.offset) ? data.offset : offset + chunk.size;
          if (data?.complete) {
            break;
          }
        }

        stored += 1;
        uploadProgress.value = { file: name, percent: 100 };
      } catch (error) {
        skipped += 1;
        errors.push({ file: name, error: error?.message || 'Upload failed' });
      }
    }

    uploadMessage.value = `Uploaded ${stored} file${stored === 1 ? '' : 's'}${
      skipped ? `, skipped ${skipped}` : ''
    }.`;
    if (errors.length) {
      uploadErrors.value = errors.slice(0, 5);
    }
    if (isSearchMode.value) {
      await runSearch({ reset: true });
    } else {
      await loadList({ reset: true });
    }
  } finally {
    uploading.value = false;
  }
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
  if (isTrashView.value) {
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

async function loadTrash({ reset = true } = {}) {
  if (!isTrashView.value) {
    return;
  }
  if (reset) {
    trashOffset.value = 0;
    trashTotal.value = 0;
    trashItems.value = [];
    clearSelection();
  }
  loading.value = true;
  error.value = '';
  try {
    const offset = reset ? 0 : trashOffset.value;
    const res = await apiFetch(
      `/api/trash?root=__all__&limit=${props.pageSize}&offset=${offset}`
    );
    if (!res.ok) {
      error.value = 'Failed to load trash';
      return;
    }
    const data = await res.json();
    const newItems = data.items || [];
    trashItems.value = reset ? newItems : [...trashItems.value, ...newItems];
    trashTotal.value = data.total || 0;
    trashOffset.value = offset + newItems.length;
  } catch {
    error.value = 'Failed to load trash';
  } finally {
    loading.value = false;
  }
}

async function runSearch({ reset = true } = {}) {
  if (isTrashView.value) {
    return;
  }
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
  if (isTrashView.value) {
    return;
  }
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
  if (isTrashView.value) {
    if (event?.metaKey || event?.ctrlKey) {
      toggleItemSelection(item);
    } else if (event?.shiftKey) {
      selectRange(item, { additive: event?.metaKey || event?.ctrlKey });
    } else {
      setSingleSelection(item);
      if (!item.isDir && isMedia(item)) {
        openModal(item);
      }
    }
    return;
  }
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
  if (isTrashView.value) {
    return;
  }
  currentPath.value = crumb.path;
  searchQuery.value = '';
  loadList({ reset: true });
}

async function downloadZip() {
  if (isTrashView.value) {
    return;
  }
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
  if (isTrashView.value) {
    await loadTrash({ reset: false });
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
  if (isTrashView.value) {
    return;
  }
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => runSearch({ reset: true }), 250);
});

watch(searchAllRoots, () => {
  clearSelection();
  if (isTrashView.value) {
    return;
  }
  if (isSearchMode.value) {
    runSearch({ reset: true });
  }
});

watch(
  () => props.currentRoot,
  () => {
    if (isTrashView.value) {
      return;
    }
    currentPath.value = '';
    searchQuery.value = '';
    modalItem.value = null;
    modalOpen.value = false;
    uploadMessage.value = '';
    uploadErrors.value = [];
    uploadProgress.value = { file: '', percent: 0 };
    dragActive.value = false;
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
    if (isTrashView.value) {
      return;
    }
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
    if (isTrashView.value) {
      loadTrash({ reset: true });
      return;
    }
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
  const handleWindowDragOver = (event) => {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
    }
  };
  const handleWindowDrop = (event) => {
    if (event.dataTransfer?.types?.includes('Files')) {
      event.preventDefault();
      dragDepth.value = 0;
      dragActive.value = false;
    }
  };
  window.addEventListener('dragover', handleWindowDragOver);
  window.addEventListener('drop', handleWindowDrop);
  window.addEventListener('keydown', handleKey);
  window.__localCloudDragOver = handleWindowDragOver;
  window.__localCloudDrop = handleWindowDrop;
});

onUnmounted(() => {
  if (window.__localCloudDragOver) {
    window.removeEventListener('dragover', window.__localCloudDragOver);
    delete window.__localCloudDragOver;
  }
  if (window.__localCloudDrop) {
    window.removeEventListener('drop', window.__localCloudDrop);
    delete window.__localCloudDrop;
  }
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
      <button
        class="root-btn trash-btn"
        :class="{ active: isTrashView }"
        @click="openTrash"
      >
        <i class="fa-solid fa-trash"></i>
        Recycle Bin
      </button>
    </aside>
    <div class="sidebar-scrim" @click="closeSidebar"></div>

    <main
      class="browser"
      :class="{ 'drag-active': dragActive }"
      @dragenter="handleDragEnter"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
    >
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
            v-if="!isTrashView"
            class="icon-btn"
            @click="refreshPath(currentPath)"
            :disabled="!currentRoot"
            aria-label="Refresh this folder"
          >
            <i class="fa-solid fa-rotate-right"></i>
          </button>
          <button
            v-if="!isTrashView"
            class="action-btn"
            @click="openFilePicker"
            :disabled="!currentRoot || uploading || !uploadEnabled"
          >
            <i class="fa-solid fa-arrow-up-from-bracket"></i>
            Upload
          </button>
          <input
            v-if="!isTrashView"
            ref="fileInput"
            class="sr-only"
            type="file"
            multiple
            @change="handleFileSelect"
          />
          <input
            class="search"
            type="search"
            placeholder="Search files"
            v-model="searchQuery"
            :disabled="isTrashView"
          />
          <label v-if="!isTrashView" class="search-scope">
            <input type="checkbox" v-model="searchAllRoots" />
            <span>All roots</span>
          </label>
          <button
            v-if="!isTrashView"
            class="action-btn secondary"
            @click="downloadZip"
            :disabled="!selectionCount"
          >
            Download ({{ selectionCount }})
          </button>
          <button
            v-if="isTrashView"
            class="action-btn secondary"
            :disabled="!selectionCount"
            @click="restoreSelection"
          >
            Restore ({{ selectionCount }})
          </button>
          <button
            v-if="isTrashView"
            class="action-btn secondary"
            :disabled="!selectionCount"
            @click="deleteTrashSelection"
          >
            Delete Permanently ({{ selectionCount }})
          </button>
          <button v-if="isTrashView" class="action-btn" @click="clearTrash">
            Empty Trash
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

      <div
        v-if="uploadMessage || !uploadEnabled"
        class="upload-status"
        :class="{ busy: uploading }"
      >
        <span v-if="!uploadEnabled">Uploads are disabled on this server.</span>
        <span v-if="uploadMessage">{{ uploadMessage }}</span>
        <span v-if="uploading && uploadProgress.file">
          {{ uploadProgress.file }} ({{ uploadProgress.percent }}%)
        </span>
        <div v-if="uploadErrors.length" class="upload-errors">
          <div v-for="(err, index) in uploadErrors" :key="`${err.file}-${index}`">
            {{ err.file }}: {{ err.error }}
          </div>
        </div>
      </div>

      <div v-if="dragActive" class="drop-overlay">
        <div>
          <i class="fa-solid fa-cloud-arrow-up"></i>
          Drop files to upload
        </div>
      </div>

      <div v-if="loading && !displayItems.length" class="empty-state">Loading files...</div>
      <div v-else-if="error" class="empty-state">{{ error }}</div>
      <div v-else-if="!displayItems.length" class="empty-state">
        <span v-if="isTrashView">Recycle Bin is empty.</span>
        <span v-else>Drop files into the root folder to populate this view.</span>
      </div>

      <div v-else-if="viewMode === 'list'">
        <div class="list-header">
          <div>Name</div>
          <div>Size</div>
          <div>{{ isTrashView ? 'Deleted' : 'Modified' }}</div>
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
                <div v-if="isSearchMode || isTrashView" class="item-path">
                  <span v-if="isTrashView">{{ item.rootName }} / </span>{{ item.path }}
                </div>
              </div>
            </div>
          <div>{{ item.isDir ? '--' : formatSize(item.size) }}</div>
          <div>{{ formatDate(isTrashView ? item.deletedAt : item.mtime) }}</div>
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
                v-if="isTrashView && isImage(item)"
                :src="trashFileUrl(item.trashId)"
                :alt="item.name"
              />
              <span v-else-if="isTrashView" class="icon"><i :class="iconClass(item)"></i></span>
              <img
                v-else-if="isImage(item) && !hasImageError(item, 'thumb')"
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
            <div v-if="isSearchMode || isTrashView" class="item-path">
              <span v-if="isTrashView">{{ item.rootName }} / </span>{{ item.path }}
            </div>
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
          v-if="isTrashView && isImage(activeItem)"
          :src="trashFileUrl(activeItem.trashId)"
          :alt="activeItem.name"
        />
        <video
          v-else-if="isTrashView && isVideo(activeItem)"
          :src="trashFileUrl(activeItem.trashId)"
          controls
        />
        <audio
          v-else-if="isTrashView && isAudio(activeItem)"
          :src="trashFileUrl(activeItem.trashId)"
          controls
        />
        <div v-else-if="isTrashView" class="icon">
          <i class="fa-solid fa-trash"></i>
          <div class="media-fallback-meta">In Recycle Bin</div>
        </div>
        <img
          v-else-if="isImage(activeItem) && !hasImageError(activeItem, 'panel')"
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
        <div v-if="isTrashView">Deleted: {{ formatDate(activeItem.deletedAt) }}</div>
        <div v-else>{{ formatDate(activeItem.mtime) }}</div>
      </div>
      <a
        v-if="activeItem && !activeItem.isDir && !isTrashView"
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
        :href="isTrashView ? trashFileUrl(modalItem.trashId, true) : downloadUrl(itemRootId(modalItem), modalItem.path)"
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
        v-if="isTrashView && isImage(modalItem)"
        :src="trashFileUrl(modalItem.trashId)"
        :alt="modalItem.name"
        :style="{ transform: `scale(${zoomLevel})` }"
      />
      <video
        v-else-if="isTrashView && isVideo(modalItem)"
        :src="trashFileUrl(modalItem.trashId)"
        controls
      ></video>
      <audio
        v-else-if="isTrashView && isAudio(modalItem)"
        :src="trashFileUrl(modalItem.trashId)"
        controls
      ></audio>
      <img
        v-else-if="isImage(modalItem) && !hasImageError(modalItem, 'modal')"
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
      <div v-if="isTrashView">Deleted: {{ formatDate(modalItem.deletedAt) }}</div>
      <div v-else>Modified: {{ formatDate(modalItem.mtime) }}</div>
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
      v-if="!isTrashView"
      class="context-menu-item"
      @click="handleItemDownload(itemMenu.item)"
    >
      <i class="fa-solid fa-download"></i>
      Download
    </button>
    <button
      v-if="isTrashView"
      class="context-menu-item"
      @click="restoreSelection"
    >
      <i class="fa-solid fa-rotate-left"></i>
      Restore
    </button>
    <button
      v-if="isTrashView"
      class="context-menu-item danger"
      @click="deleteTrashSelection"
    >
      <i class="fa-solid fa-trash-can"></i>
      Delete permanently
    </button>
    <button
      v-if="!isTrashView"
      class="context-menu-item danger"
      @click="deleteSelection"
    >
      <i class="fa-solid fa-trash"></i>
      Delete
    </button>
    <button
      v-if="!isTrashView && itemMenu.item && isAudio(itemMenu.item)"
      class="context-menu-item"
      @click="handleOpenInMusic(itemMenu.item)"
    >
      <i class="fa-solid fa-music"></i>
      Open in Music
    </button>
    <button
      v-if="!isTrashView && itemMenu.item && isImage(itemMenu.item)"
      class="context-menu-item"
      @click="handleOpenInPhotos(itemMenu.item)"
    >
      <i class="fa-solid fa-image"></i>
      Open in Photos
    </button>
    <button
      v-if="!isTrashView && selectionCount > 1"
      class="context-menu-item"
      @click="handleDownloadSelection"
    >
      <i class="fa-solid fa-file-zipper"></i>
      Download selection ({{ selectionCount }})
    </button>
  </div>
</template>
