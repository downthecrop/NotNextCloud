<script setup>
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  pageSize: {
    type: Number,
    required: true,
  },
  status: {
    type: Object,
    required: true,
  },
  onClose: {
    type: Function,
    required: true,
  },
  onPageSizeChange: {
    type: Function,
    required: true,
  },
  onRescanFiles: {
    type: Function,
    required: true,
  },
  onRescanMusic: {
    type: Function,
    required: true,
  },
  onRebuildThumbs: {
    type: Function,
    required: true,
  },
  formatDate: {
    type: Function,
    required: true,
  },
});
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="onClose">
    <div class="modal-card">
      <h3>Settings</h3>
      <div class="settings-panel">
        <label for="max-items">Max items per page</label>
        <select id="max-items" :value="pageSize" @change="onPageSizeChange($event.target.value)">
          <option value="25">25</option>
          <option value="50">50</option>
          <option value="100">100</option>
          <option value="200">200</option>
        </select>
        <button class="action-btn" @click="onRescanFiles">Rescan files</button>
        <button class="action-btn secondary" @click="onRescanMusic">Rescan music</button>
        <button class="action-btn secondary" @click="onRebuildThumbs">Rebuild thumbnails</button>
        <div class="meta">
          Last scan: {{ formatDate(status.lastScanAt) || 'Not yet' }}<br />
          Interval: {{ status.scanIntervalSeconds }}s
        </div>
      </div>
      <div class="modal-actions">
        <button class="action-btn secondary" @click="onClose">Close</button>
      </div>
    </div>
  </div>
</template>
