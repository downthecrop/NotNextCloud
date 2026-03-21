import { computed, ref } from 'vue';

const uploadQueueOpen = ref(false);
const uploadQueueEntries = ref([]);
let uploadQueueCounter = 0;

function nextUploadId() {
  uploadQueueCounter += 1;
  return `upload-${Date.now()}-${uploadQueueCounter}`;
}

function trimUploadEntries() {
  if (uploadQueueEntries.value.length <= 24) {
    return;
  }
  const active = uploadQueueEntries.value.filter(
    (entry) => entry.status === 'preparing' || entry.status === 'uploading'
  );
  const settled = uploadQueueEntries.value.filter(
    (entry) => entry.status !== 'preparing' && entry.status !== 'uploading'
  );
  uploadQueueEntries.value = [...active, ...settled.slice(-20)];
}

const activeUploadCount = computed(
  () =>
    uploadQueueEntries.value.filter(
      (entry) => entry.status === 'preparing' || entry.status === 'uploading'
    ).length
);

const finishedUploadCount = computed(
  () =>
    uploadQueueEntries.value.filter(
      (entry) => entry.status === 'complete' || entry.status === 'error' || entry.status === 'skipped'
    ).length
);

function createUploadEntry({ name, rootId = '', folderPath = '', size = 0 }) {
  const id = nextUploadId();
  uploadQueueEntries.value = [
    {
      id,
      name: name || 'upload',
      rootId,
      folderPath,
      size,
      percent: 0,
      status: 'queued',
      message: 'Queued',
      error: '',
      startedAt: Date.now(),
      updatedAt: Date.now(),
    },
    ...uploadQueueEntries.value,
  ];
  trimUploadEntries();
  return id;
}

function updateUploadEntry(id, patch = {}) {
  if (!id) {
    return;
  }
  uploadQueueEntries.value = uploadQueueEntries.value.map((entry) =>
    entry.id === id
      ? {
          ...entry,
          ...patch,
          updatedAt: Date.now(),
        }
      : entry
  );
  trimUploadEntries();
}

function clearFinishedUploads() {
  uploadQueueEntries.value = uploadQueueEntries.value.filter(
    (entry) => entry.status === 'preparing' || entry.status === 'uploading' || entry.status === 'queued'
  );
}

function setUploadQueueOpen(value) {
  uploadQueueOpen.value = Boolean(value);
}

function toggleUploadQueue() {
  uploadQueueOpen.value = !uploadQueueOpen.value;
}

export function useUploadQueueStore() {
  return {
    uploadQueueOpen,
    uploadQueueEntries,
    activeUploadCount,
    finishedUploadCount,
    createUploadEntry,
    updateUploadEntry,
    clearFinishedUploads,
    setUploadQueueOpen,
    toggleUploadQueue,
  };
}
