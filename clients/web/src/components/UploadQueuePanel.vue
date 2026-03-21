<script setup>
import { computed } from 'vue';
import { formatSize } from '../utils/formatting';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  items: {
    type: Array,
    default: () => [],
  },
  activeCount: {
    type: Number,
    default: 0,
  },
  finishedCount: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(['toggle', 'clear-finished']);

const hasItems = computed(() => props.items.length > 0);
const panelTitle = computed(() => {
  if (props.activeCount > 0) {
    return `${props.activeCount} upload${props.activeCount === 1 ? '' : 's'} in progress`;
  }
  if (hasItems.value) {
    return 'Recent uploads';
  }
  return 'Uploads';
});

function itemStatusLabel(item) {
  if (item.status === 'complete') {
    return 'Completed';
  }
  if (item.status === 'error') {
    return 'Failed';
  }
  if (item.status === 'skipped') {
    return 'Skipped';
  }
  if (item.status === 'uploading') {
    return `${item.percent || 0}%`;
  }
  if (item.status === 'preparing') {
    return 'Preparing';
  }
  return 'Queued';
}

function itemIcon(item) {
  if (item.status === 'complete') {
    return 'fa-solid fa-circle-check';
  }
  if (item.status === 'error') {
    return 'fa-solid fa-circle-exclamation';
  }
  if (item.status === 'skipped') {
    return 'fa-solid fa-forward';
  }
  return 'fa-solid fa-arrow-up-from-bracket';
}
</script>

<template>
  <div class="upload-queue-shell" :class="{ open }">
    <button
      class="upload-queue-tab"
      type="button"
      @click="emit('toggle')"
      :aria-expanded="open"
      aria-label="Toggle upload queue"
    >
      <span class="icon"><i class="fa-solid fa-cloud-arrow-up"></i></span>
      <span class="upload-queue-tab-copy">
        <strong>Uploads</strong>
        <span>{{ activeCount > 0 ? `${activeCount} active` : hasItems ? `${items.length} recent` : 'Idle' }}</span>
      </span>
    </button>

    <div v-if="open" class="upload-queue-panel">
      <div class="upload-queue-header">
        <div class="upload-queue-header-copy">
          <strong>{{ panelTitle }}</strong>
          <span>{{ hasItems ? 'Uploads continue in the background.' : 'No uploads yet.' }}</span>
        </div>
        <div class="upload-queue-actions">
          <button
            v-if="finishedCount"
            class="icon-btn"
            type="button"
            @click="emit('clear-finished')"
            aria-label="Clear finished uploads"
          >
            <i class="fa-solid fa-broom"></i>
          </button>
          <button class="icon-btn" type="button" @click="emit('toggle')" aria-label="Collapse upload queue">
            <i class="fa-solid fa-chevron-down"></i>
          </button>
        </div>
      </div>

      <div v-if="!hasItems" class="upload-queue-empty">
        Start an upload from Files and it will appear here.
      </div>

      <div v-else class="upload-queue-list">
        <div v-for="item in items" :key="item.id" class="upload-queue-item" :class="`status-${item.status}`">
          <div class="upload-queue-item-icon">
            <i :class="itemIcon(item)"></i>
          </div>
          <div class="upload-queue-item-copy">
            <div class="upload-queue-item-topline">
              <strong>{{ item.name }}</strong>
              <span>{{ itemStatusLabel(item) }}</span>
            </div>
            <div class="upload-queue-item-meta">
              <span v-if="item.folderPath">{{ item.folderPath || '/' }}</span>
              <span v-if="item.size">{{ formatSize(item.size) }}</span>
            </div>
            <div
              v-if="item.status === 'preparing' || item.status === 'uploading'"
              class="upload-queue-progress"
            >
              <div class="upload-queue-progress-fill" :style="{ width: `${Math.max(6, item.percent || 0)}%` }"></div>
            </div>
            <div v-if="item.error" class="upload-queue-item-error">{{ item.error }}</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
