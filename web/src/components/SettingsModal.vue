<script setup>
import { ref, watch, computed } from 'vue';
import { formatSize } from '../utils/formatting';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  roots: {
    type: Array,
    default: () => [],
  },
  pageSize: {
    type: Number,
    required: true,
  },
  status: {
    type: Object,
    required: true,
  },
  apiInfo: {
    type: Object,
    default: null,
  },
  uploadOverwrite: {
    type: Boolean,
    default: false,
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
  onUpdateRoots: {
    type: Function,
    required: true,
  },
  onUpdateScanSettings: {
    type: Function,
    required: true,
  },
  onUploadOverwriteChange: {
    type: Function,
    required: true,
  },
  formatDate: {
    type: Function,
    required: true,
  },
});

const tabs = [
  { id: 'general', label: 'General' },
  { id: 'drives', label: 'Drives' },
  { id: 'uploads', label: 'Uploads' },
];
const activeTab = ref('general');
const draftRoots = ref([]);
const savingRoots = ref(false);
const saveError = ref('');
const savingScan = ref(false);
const scanError = ref('');
const uploadInfo = computed(() => props.apiInfo?.capabilities?.upload || null);
const uploadEnabled = computed(() => uploadInfo.value?.enabled !== false);
const uploadMaxBytes = computed(() => uploadInfo.value?.maxBytes || 0);
const uploadMaxFiles = computed(() => uploadInfo.value?.maxFiles || 0);
const uploadChunkBytes = computed(() => uploadInfo.value?.chunkBytes || 0);
const uploadResume = computed(() => uploadInfo.value?.resume === true);

const hasEmptyPath = computed(() =>
  draftRoots.value.some((root) => !(root.path || '').trim())
);

function resetDraftRoots() {
  draftRoots.value = props.roots.map((root) => ({
    id: root.id || '',
    name: root.name || '',
    path: root.path || '',
  }));
  saveError.value = '';
}

function addDrive() {
  draftRoots.value.push({ id: '', name: '', path: '' });
}

function removeDrive(index) {
  draftRoots.value.splice(index, 1);
}

async function saveDrives() {
  if (hasEmptyPath.value) {
    return;
  }
  saveError.value = '';
  savingRoots.value = true;
  try {
    const result = await props.onUpdateRoots(draftRoots.value);
    if (!result?.ok) {
      saveError.value = result?.error || 'Failed to update drives.';
    }
  } catch {
    saveError.value = 'Failed to update drives.';
  } finally {
    savingRoots.value = false;
  }
}

async function updateScanSettings(patch) {
  scanError.value = '';
  savingScan.value = true;
  const nextSettings = {
    scanIntervalSeconds: statusValue('scanIntervalSeconds', 60),
    fastScan: statusValue('fastScan', true),
    fullScanIntervalHours: statusValue('fullScanIntervalHours', 0),
    ...patch,
  };
  try {
    const result = await props.onUpdateScanSettings(nextSettings);
    if (!result?.ok) {
      scanError.value = result?.error || 'Failed to update scan settings.';
    }
  } catch {
    scanError.value = 'Failed to update scan settings.';
  } finally {
    savingScan.value = false;
  }
}

function statusValue(key, fallback) {
  const value = props.status?.[key];
  return Number.isFinite(value) || typeof value === 'boolean' ? value : fallback;
}

watch(
  () => props.open,
  (value) => {
    if (value) {
      activeTab.value = 'general';
      resetDraftRoots();
    }
  }
);

watch(
  () => props.roots,
  () => {
    if (props.open) {
      resetDraftRoots();
    }
  }
);
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="onClose">
    <div class="modal-card settings-modal">
      <h3>Settings</h3>
      <div class="settings-shell">
        <aside class="settings-sidebar" role="tablist" aria-label="Settings sections">
          <button
            v-for="tab in tabs"
            :key="tab.id"
            class="settings-tab"
            type="button"
            role="tab"
            :aria-selected="activeTab === tab.id"
            :class="{ active: activeTab === tab.id }"
            @click="activeTab = tab.id"
          >
            {{ tab.label }}
          </button>
        </aside>
        <section class="settings-content">
          <div v-if="activeTab === 'general'" class="settings-view">
            <div class="settings-panel">
              <label for="max-items">Max items per page</label>
              <select
                id="max-items"
                :value="pageSize"
                @change="onPageSizeChange($event.target.value)"
              >
                <option value="25">25</option>
                <option value="50">50</option>
                <option value="100">100</option>
                <option value="200">200</option>
              </select>
            </div>
            <div class="settings-panel">
              <div class="settings-panel-title">Indexer status</div>
              <div class="settings-meta">
                <div>Last scan: {{ formatDate(status.lastScanAt) || 'Not yet' }}</div>
                <div>Interval: {{ status.scanIntervalSeconds }}s</div>
                <div>Status: {{ status.scanInProgress ? 'Running' : 'Idle' }}</div>
              </div>
            </div>
            <div class="settings-panel">
              <div class="settings-panel-title">Scan schedule</div>
              <label for="scan-interval">Fast scan interval</label>
              <select
                id="scan-interval"
                :value="status.scanIntervalSeconds || 60"
                :disabled="savingScan"
                @change="updateScanSettings({ scanIntervalSeconds: Number($event.target.value) })"
              >
                <option value="60">Every minute</option>
                <option value="300">Every 5 minutes</option>
                <option value="900">Every 15 minutes</option>
                <option value="3600">Hourly</option>
              </select>
              <label for="full-scan">Full scan cadence</label>
              <select
                id="full-scan"
                :value="status.fullScanIntervalHours || 0"
                :disabled="savingScan"
                @change="updateScanSettings({ fullScanIntervalHours: Number($event.target.value) })"
              >
                <option value="0">Off</option>
                <option value="24">Daily</option>
                <option value="168">Weekly</option>
              </select>
              <label class="settings-toggle">
                <input
                  type="checkbox"
                  :checked="status.fastScan !== false"
                  :disabled="savingScan"
                  @change="updateScanSettings({ fastScan: $event.target.checked })"
                />
                Use fast scan (skip unchanged folders)
              </label>
              <div v-if="scanError" class="settings-error">{{ scanError }}</div>
            </div>
          </div>
          <div v-else-if="activeTab === 'uploads'" class="settings-view">
            <div class="settings-panel">
              <div class="settings-panel-title">Upload service</div>
              <div class="settings-meta" v-if="apiInfo">
                <div>Status: {{ uploadEnabled ? 'Enabled' : 'Disabled' }}</div>
                <div>
                  Max file size:
                  {{ uploadMaxBytes ? formatSize(uploadMaxBytes) : 'Unlimited' }}
                </div>
                <div>Max files per batch: {{ uploadMaxFiles || 'Unlimited' }}</div>
                <div>
                  Server overwrite default:
                  {{ uploadInfo?.overwriteByDefault ? 'On' : 'Off' }}
                </div>
                <div>Resume supported: {{ uploadResume ? 'Yes' : 'No' }}</div>
                <div>
                  Chunk size: {{ uploadChunkBytes ? formatSize(uploadChunkBytes) : 'Unknown' }}
                </div>
                <div>API version: {{ apiInfo.apiVersion }}</div>
              </div>
              <div v-else class="settings-hint">Loading upload settings...</div>
            </div>
            <div class="settings-panel">
              <div class="settings-panel-title">Client defaults</div>
              <label class="settings-toggle">
                <input
                  type="checkbox"
                  :checked="uploadOverwrite"
                  @change="onUploadOverwriteChange($event.target.checked)"
                />
                Overwrite existing files when uploading
              </label>
              <div class="settings-hint">
                This preference only affects uploads from this browser.
              </div>
            </div>
          </div>
          <div v-else class="settings-view">
            <div class="settings-panel">
              <div class="settings-panel-title">Mount points</div>
              <div class="settings-hint">Changes sync to config.json immediately.</div>
              <div v-if="draftRoots.length" class="settings-drive-list">
                <div v-for="(root, index) in draftRoots" :key="root.id || index" class="settings-drive-editor">
                  <div class="settings-drive-fields">
                    <div class="settings-field">
                      <label :for="`drive-name-${index}`">Name</label>
                      <input
                        :id="`drive-name-${index}`"
                        v-model="root.name"
                        type="text"
                        placeholder="Media"
                      />
                    </div>
                    <div class="settings-field">
                      <label :for="`drive-path-${index}`">Path</label>
                      <input
                        :id="`drive-path-${index}`"
                        v-model="root.path"
                        type="text"
                        placeholder="/Volumes/Media"
                      />
                    </div>
                  </div>
                  <div class="settings-drive-footer">
                    <div class="settings-drive-id">ID: {{ root.id || 'Auto' }}</div>
                    <button class="icon-btn danger" type="button" @click="removeDrive(index)">
                      Remove
                    </button>
                  </div>
                </div>
              </div>
              <div v-else class="meta">No drives yet. Add one below.</div>
              <div class="settings-drive-actions">
                <button class="action-btn secondary" type="button" @click="addDrive">
                  Add drive
                </button>
                <button
                  class="action-btn"
                  type="button"
                  :disabled="savingRoots || hasEmptyPath"
                  @click="saveDrives"
                >
                  Save changes
                </button>
              </div>
              <div v-if="hasEmptyPath" class="settings-warning">Each drive needs a path.</div>
              <div v-if="saveError" class="settings-error">{{ saveError }}</div>
            </div>
            <div class="settings-panel">
              <div class="settings-panel-title">Actions</div>
              <div class="settings-actions">
                <button class="action-btn" @click="onRescanFiles">Rescan files</button>
                <button class="action-btn secondary" @click="onRescanMusic">Rescan music</button>
                <button class="action-btn secondary" @click="onRebuildThumbs">
                  Rebuild thumbnails
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div class="modal-actions">
        <button class="action-btn secondary" @click="onClose">Close</button>
      </div>
    </div>
  </div>
</template>
