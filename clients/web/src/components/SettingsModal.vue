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
  {
    id: 'general',
    label: 'General',
    icon: 'fa-solid fa-sliders',
    description: 'Indexer health, performance tuning, and system behavior.',
  },
  {
    id: 'drives',
    label: 'Library',
    icon: 'fa-solid fa-hard-drive',
    description: 'Storage roots, mount points, and manual maintenance actions.',
  },
  {
    id: 'uploads',
    label: 'Uploads',
    icon: 'fa-solid fa-cloud-arrow-up',
    description: 'Transfer limits, resume support, and browser-side defaults.',
  },
];

const activeTab = ref('general');
const searchQuery = ref('');
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
const progress = computed(() => props.status?.progress || null);
const progressPercent = computed(() =>
  Number.isFinite(progress.value?.percent) ? progress.value.percent : null
);
const thumbnailStats = computed(() => props.status?.thumbnailStats || null);
const thumbnailCoverage = computed(() => {
  const created = thumbnailStats.value?.created;
  const total = thumbnailStats.value?.total;
  if (!Number.isFinite(created) || !Number.isFinite(total) || total <= 0) {
    return null;
  }
  return Math.max(0, Math.min(100, Math.round((created / total) * 100)));
});
const countFormatter = new Intl.NumberFormat('en-US');
const formatCount = (value) => (Number.isFinite(value) ? countFormatter.format(value) : '0');
const formatCountMaybe = (value) => (Number.isFinite(value) ? formatCount(value) : '...');

const filteredTabs = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) {
    return tabs;
  }
  return tabs.filter((tab) =>
    [tab.label, tab.description].some((value) => value.toLowerCase().includes(query))
  );
});
const activeTabInfo = computed(() => tabs.find((tab) => tab.id === activeTab.value) || tabs[0]);
const rootCount = computed(() => props.roots.length);
const statusLabel = computed(() => (props.status?.scanInProgress ? 'Running' : 'Idle'));
const driveSummary = computed(() =>
  rootCount.value === 1 ? '1 storage root connected' : `${rootCount.value} storage roots connected`
);
const uploadSummary = computed(() => (uploadEnabled.value ? 'Uploads enabled' : 'Uploads disabled'));

const overviewCards = computed(() => {
  if (activeTab.value === 'general') {
    return [
      {
        label: 'Storage Roots',
        value: `${rootCount.value}`,
        detail: driveSummary.value,
      },
      {
        label: 'Indexer',
        value: statusLabel.value,
        detail: `Fast scan ${props.status?.fastScan !== false ? 'enabled' : 'disabled'}`,
      },
      {
        label: 'Thumbnails',
        value: thumbnailCoverage.value !== null ? `${thumbnailCoverage.value}%` : 'Pending',
        detail: `${formatCountMaybe(thumbnailStats.value?.created)} generated`,
      },
    ];
  }
  if (activeTab.value === 'uploads') {
    return [
      {
        label: 'Service',
        value: uploadEnabled.value ? 'Enabled' : 'Disabled',
        detail: uploadResume.value ? 'Resume supported' : 'Resume unavailable',
      },
      {
        label: 'Chunk Size',
        value: uploadChunkBytes.value ? formatSize(uploadChunkBytes.value) : 'Unknown',
        detail: `Max files ${uploadMaxFiles.value || 'Unlimited'}`,
      },
      {
        label: 'Overwrite',
        value: props.uploadOverwrite ? 'On' : 'Off',
        detail: 'Browser default',
      },
    ];
  }
  return [
    {
      label: 'Storage Roots',
      value: `${rootCount.value}`,
      detail: 'Mounted in the active library',
    },
    {
      label: 'Library',
      value: statusLabel.value,
      detail: props.formatDate(props.status?.lastScanAt) || 'No scan yet',
    },
    {
      label: 'Actions',
      value: 'Ready',
      detail: 'Manual rescans available',
    },
  ];
});

function resetDraftRoots() {
  draftRoots.value = props.roots.map((root) => ({
    id: root.id || '',
    name: root.name || '',
    path: root.path || '',
  }));
  saveError.value = '';
}

const hasEmptyPath = computed(() =>
  draftRoots.value.some((root) => !(root.path || '').trim())
);

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

function statusValue(key, fallback) {
  const value = props.status?.[key];
  return Number.isFinite(value) || typeof value === 'boolean' ? value : fallback;
}

async function updateScanSettings(patch) {
  scanError.value = '';
  savingScan.value = true;
  const nextSettings = {
    scanIntervalSeconds: statusValue('scanIntervalSeconds', 60),
    fastScan: statusValue('fastScan', true),
    scanFsConcurrency: statusValue('scanFsConcurrency', 8),
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

watch(
  () => props.open,
  (value) => {
    if (value) {
      activeTab.value = 'general';
      searchQuery.value = '';
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

watch(filteredTabs, (nextTabs) => {
  if (!nextTabs.some((tab) => tab.id === activeTab.value)) {
    activeTab.value = nextTabs[0]?.id || 'general';
  }
});
</script>

<template>
  <div v-if="open" class="modal-overlay" @click.self="onClose">
    <div class="modal-card settings-modal">
      <div class="settings-window-bar">
        <div class="settings-window-title">{{ activeTabInfo.label }}</div>
        <button class="icon-btn settings-close-btn" type="button" @click="onClose" aria-label="Close settings">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </div>

      <div class="settings-shell">
        <aside class="settings-sidebar" role="tablist" aria-label="Settings sections">
          <div class="settings-sidebar-top">
            <div class="settings-account-card">
              <div class="settings-account-avatar">
                <i class="fa-solid fa-cloud"></i>
              </div>
              <div class="settings-account-meta">
                <strong>Local Cloud</strong>
                <span>{{ driveSummary }}</span>
                <span>{{ uploadSummary }}</span>
              </div>
            </div>

            <label class="settings-search">
              <i class="fa-solid fa-magnifying-glass"></i>
              <input v-model="searchQuery" type="search" placeholder="Search settings" />
            </label>
          </div>

          <div class="settings-nav-list">
            <button
              v-for="tab in filteredTabs"
              :key="tab.id"
              class="settings-tab"
              type="button"
              role="tab"
              :aria-selected="activeTab === tab.id"
              :class="{ active: activeTab === tab.id }"
              @click="activeTab = tab.id"
            >
              <span class="settings-tab-icon"><i :class="tab.icon"></i></span>
              <span class="settings-tab-copy">
                <span class="settings-tab-label">{{ tab.label }}</span>
                <span class="settings-tab-description">{{ tab.description }}</span>
              </span>
            </button>
          </div>
        </aside>

        <section class="settings-content">
          <header class="settings-hero">
            <div class="settings-hero-icon">
              <i :class="activeTabInfo.icon"></i>
            </div>
            <div class="settings-hero-copy">
              <h3>{{ activeTabInfo.label }}</h3>
              <p>{{ activeTabInfo.description }}</p>
            </div>
            <div class="settings-hero-status">
              <span class="settings-hero-chip">
                <i class="fa-solid fa-circle"></i>
                {{ statusLabel }}
              </span>
              <span class="settings-hero-chip subtle">
                {{ formatDate(status.lastScanAt) || 'No scan yet' }}
              </span>
            </div>
          </header>

          <div class="settings-overview-grid">
            <div v-for="card in overviewCards" :key="card.label" class="settings-overview-card">
              <div class="settings-overview-label">{{ card.label }}</div>
              <strong>{{ card.value }}</strong>
              <span>{{ card.detail }}</span>
            </div>
          </div>

          <div v-if="activeTab === 'general'" class="settings-view">
            <div class="settings-panel settings-panel-emphasis">
              <div class="settings-panel-header">
                <div>
                  <div class="settings-panel-title">App Behavior</div>
                  <div class="settings-panel-subtitle">Control how much content each view renders at once.</div>
                </div>
              </div>
              <div class="settings-form-row">
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
            </div>

            <div class="settings-panel">
              <div class="settings-panel-header">
                <div>
                  <div class="settings-panel-title">Indexer Status</div>
                  <div class="settings-panel-subtitle">Live background scan health and thumbnail coverage.</div>
                </div>
              </div>

              <div class="settings-meta">
                <div>Last scan: {{ formatDate(status.lastScanAt) || 'Not yet' }}</div>
                <div>Interval: {{ status.scanIntervalSeconds }}s</div>
                <div>FS concurrency: {{ status.scanFsConcurrency || 8 }}</div>
                <div>Status: {{ status.scanInProgress ? 'Running' : 'Idle' }}</div>
                <div v-if="status.lastScanStats?.indexedTotal">
                  Indexed items: {{ formatCount(status.lastScanStats.indexedTotal) }}
                </div>
                <div v-else-if="status.lastScanStats?.processedEntries">
                  Last scan processed: {{ formatCount(status.lastScanStats.processedEntries) }}
                </div>
                <div v-if="status.lastScanStats?.errorCount">
                  Last scan errors: {{ formatCount(status.lastScanStats.errorCount) }}
                </div>
                <div
                  v-for="entry in status.lastScanStats?.errorCodes || []"
                  :key="`scan-error-code-${entry.code}`"
                >
                  {{ entry.code }}: {{ formatCount(entry.count) }}
                </div>
                <div
                  v-for="entry in status.lastScanStats?.roots || []"
                  :key="`scan-root-${entry.rootId}-${entry.scope}-${entry.relPath || ''}`"
                >
                  {{ entry.rootName || entry.rootId }}:
                  {{ formatCount(entry.processedEntries) }} items in
                  {{ Math.max(0, Math.round((entry.durationMs || 0) / 1000)) }}s
                  <span v-if="entry.errorCount">({{ formatCount(entry.errorCount) }} errors)</span>
                </div>
                <div>Thumbnails created: {{ formatCountMaybe(thumbnailStats?.created) }}</div>
                <div>Thumbnails queued: {{ formatCountMaybe(thumbnailStats?.queued) }}</div>
                <div>Thumbnails total: {{ formatCountMaybe(thumbnailStats?.total) }}</div>
                <div v-if="thumbnailCoverage !== null">Thumbnail coverage: {{ thumbnailCoverage }}%</div>
                <div v-if="Number.isFinite(thumbnailStats?.workersTotal)">
                  Thumbnail workers:
                  {{ formatCountMaybe(thumbnailStats?.workersBusy) }} / {{ formatCountMaybe(thumbnailStats?.workersTotal) }}
                </div>
                <div v-if="thumbnailStats?.lastUpdatedAt">
                  Thumbnail stats updated: {{ formatDate(thumbnailStats.lastUpdatedAt) }}
                </div>
              </div>

              <div v-if="status.scanInProgress && progress" class="settings-progress">
                <div class="settings-progress-header">
                  <span>Indexing...</span>
                  <span v-if="progressPercent !== null">{{ progressPercent }}%</span>
                </div>
                <div class="settings-progress-bar">
                  <div
                    class="settings-progress-fill"
                    :class="{ indeterminate: progressPercent === null }"
                    :style="{ width: progressPercent !== null ? `${progressPercent}%` : '35%' }"
                  ></div>
                </div>
                <div class="settings-progress-meta">
                  <div>Indexed: {{ formatCount(progress.processedEntries) }} items</div>
                  <div v-if="progress.expectedTotal">
                    Estimated total: {{ formatCount(progress.expectedTotal) }}
                  </div>
                  <div v-if="progress.currentRootName">Drive: {{ progress.currentRootName }}</div>
                  <div v-if="progress.currentPath" class="settings-progress-path">
                    Path: {{ progress.currentPath }}
                  </div>
                  <div v-if="progress.mode">Mode: {{ progress.mode }}</div>
                </div>
              </div>
            </div>

            <div class="settings-panel">
              <div class="settings-panel-header">
                <div>
                  <div class="settings-panel-title">Scan Schedule</div>
                  <div class="settings-panel-subtitle">Control cadence and filesystem scan pressure.</div>
                </div>
              </div>

              <div class="settings-form-grid">
                <div class="settings-form-row">
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
                </div>

                <div class="settings-form-row">
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
                </div>

                <div class="settings-form-row">
                  <label for="scan-fs-concurrency">Filesystem scan concurrency</label>
                  <select
                    id="scan-fs-concurrency"
                    :value="status.scanFsConcurrency || 8"
                    :disabled="savingScan"
                    @change="updateScanSettings({ scanFsConcurrency: Number($event.target.value) })"
                  >
                    <option value="1">1</option>
                    <option value="2">2</option>
                    <option value="4">4</option>
                    <option value="8">8</option>
                    <option value="16">16</option>
                    <option value="32">32</option>
                  </select>
                </div>
              </div>

              <label class="settings-toggle settings-toggle-card">
                <input
                  type="checkbox"
                  :checked="status.fastScan !== false"
                  :disabled="savingScan"
                  @change="updateScanSettings({ fastScan: $event.target.checked })"
                />
                <span>
                  <strong>Use fast scan</strong>
                  <span>Skip unchanged folders when possible.</span>
                </span>
              </label>

              <div v-if="scanError" class="settings-error">{{ scanError }}</div>
            </div>
          </div>

          <div v-else-if="activeTab === 'uploads'" class="settings-view">
            <div class="settings-panel">
              <div class="settings-panel-header">
                <div>
                  <div class="settings-panel-title">Upload Service</div>
                  <div class="settings-panel-subtitle">Server-side capabilities exposed to the browser.</div>
                </div>
              </div>

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
              <div class="settings-panel-header">
                <div>
                  <div class="settings-panel-title">Client Defaults</div>
                  <div class="settings-panel-subtitle">Preferences stored only in this browser.</div>
                </div>
              </div>

              <label class="settings-toggle settings-toggle-card">
                <input
                  type="checkbox"
                  :checked="uploadOverwrite"
                  @change="onUploadOverwriteChange($event.target.checked)"
                />
                <span>
                  <strong>Overwrite existing files</strong>
                  <span>Use replacement behavior for uploads started here.</span>
                </span>
              </label>

              <div class="settings-hint">
                This preference only affects uploads from this browser.
              </div>
            </div>
          </div>

          <div v-else class="settings-view">
            <div class="settings-panel">
              <div class="settings-panel-header">
                <div>
                  <div class="settings-panel-title">Mount Points</div>
                  <div class="settings-panel-subtitle">Manage the storage roots synced into the library.</div>
                </div>
              </div>

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
              <div class="settings-panel-header">
                <div>
                  <div class="settings-panel-title">Library Actions</div>
                  <div class="settings-panel-subtitle">Manual maintenance for library and preview caches.</div>
                </div>
              </div>

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

      <div class="modal-actions settings-footer">
        <button class="action-btn secondary" @click="onClose">Close</button>
      </div>
    </div>
  </div>
</template>
