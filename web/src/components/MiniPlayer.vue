<script setup>
import { ref, computed, watch, nextTick, onMounted, onUnmounted } from 'vue';
import { useApi } from '../composables/useApi';

const props = defineProps({
  tracks: {
    type: Array,
    default: () => [],
  },
  selectedTrack: {
    type: Object,
    default: null,
  },
  rootId: {
    type: String,
    default: '',
  },
  autoPlay: {
    type: Boolean,
    default: true,
  },
  autoPlayOnMount: {
    type: Boolean,
    default: false,
  },
  variant: {
    type: String,
    default: 'bar',
  },
});

const emit = defineEmits(['select']);

const { fileUrl, albumArtUrl } = useApi();

const audioRef = ref(null);
const currentTime = ref(0);
const duration = ref(0);
const isPlaying = ref(false);
const volume = ref(0.8);
const muted = ref(false);
const albumArtOk = ref(true);
const volumeOpen = ref(false);
const volumeRef = ref(null);
let volumeTimer = null;

const queue = computed(() => props.tracks || []);
const selectedRootId = computed(() => props.selectedTrack?.rootId || props.rootId || '');
const currentIndex = computed(() => {
  if (!props.selectedTrack) {
    return -1;
  }
  const selectedKey = trackKey(props.selectedTrack);
  return queue.value.findIndex((item) => trackKey(item) === selectedKey);
});
const effectiveDuration = computed(() => {
  const fallback = props.selectedTrack?.duration || 0;
  const current = duration.value || 0;
  return current > 0 ? current : fallback;
});
const seekMax = computed(() =>
  Number.isFinite(effectiveDuration.value) && effectiveDuration.value > 0 ? effectiveDuration.value : 0
);
const isEmbedded = computed(() => props.variant === 'embedded');

function trackTitle(item) {
  return item?.title || item?.name || 'Unknown Track';
}

function trackArtist(item) {
  return item?.artist || 'Unknown Artist';
}

function trackAlbum(item) {
  return item?.album || 'Unknown Album';
}

function trackRootId(item) {
  return item?.rootId || props.rootId || '';
}

function trackKey(item) {
  return item?.rootId ? `${item.rootId}:${item.path}` : item?.path;
}

function formatTime(value) {
  if (!value && value !== 0) {
    return '--:--';
  }
  const totalSeconds = Math.floor(value);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function togglePlay() {
  if (!audioRef.value || !props.selectedTrack) {
    return;
  }
  if (audioRef.value.paused) {
    audioRef.value.play().catch(() => {});
  } else {
    audioRef.value.pause();
  }
}

function playNext() {
  const list = queue.value;
  if (!list.length) {
    return;
  }
  if (currentIndex.value < 0) {
    emit('select', list[0]);
    return;
  }
  const nextIndex = currentIndex.value + 1;
  if (nextIndex < list.length) {
    emit('select', list[nextIndex]);
  }
}

function playPrev() {
  const list = queue.value;
  if (!list.length) {
    return;
  }
  if (currentTime.value > 3 && audioRef.value) {
    audioRef.value.currentTime = 0;
    return;
  }
  const prevIndex = currentIndex.value - 1;
  if (prevIndex >= 0) {
    emit('select', list[prevIndex]);
    return;
  }
  if (audioRef.value) {
    audioRef.value.currentTime = 0;
  }
}

function onSeek(event) {
  if (!audioRef.value) {
    return;
  }
  const nextValue = parseFloat(event.target.value || '0');
  audioRef.value.currentTime = nextValue;
  currentTime.value = nextValue;
}

function onTimeUpdate() {
  if (!audioRef.value) {
    return;
  }
  currentTime.value = audioRef.value.currentTime || 0;
}

function onLoadedMetadata() {
  if (!audioRef.value) {
    return;
  }
  const nextDuration = audioRef.value.duration;
  duration.value = Number.isFinite(nextDuration) ? nextDuration : duration.value;
  audioRef.value.volume = volume.value;
  audioRef.value.muted = muted.value;
}

function onPlay() {
  isPlaying.value = true;
}

function onPause() {
  isPlaying.value = false;
}

function onEnded() {
  isPlaying.value = false;
  playNext();
}

function onDurationChange() {
  if (!audioRef.value) {
    return;
  }
  const nextDuration = audioRef.value.duration;
  duration.value = Number.isFinite(nextDuration) ? nextDuration : duration.value;
}

function clearVolumeTimer() {
  if (volumeTimer) {
    clearTimeout(volumeTimer);
    volumeTimer = null;
  }
}

function scheduleVolumeClose() {
  clearVolumeTimer();
  volumeTimer = setTimeout(() => {
    volumeOpen.value = false;
  }, 2000);
}

function openVolume() {
  volumeOpen.value = true;
  scheduleVolumeClose();
}

function keepVolumeOpen() {
  if (!volumeOpen.value) {
    volumeOpen.value = true;
  }
  scheduleVolumeClose();
}

function closeVolume() {
  scheduleVolumeClose();
}

function handleVolumeFocusOut(event) {
  if (event?.currentTarget?.contains(event?.relatedTarget)) {
    return;
  }
  scheduleVolumeClose();
}

function handleGlobalPointer(event) {
  if (!volumeOpen.value || !volumeRef.value) {
    return;
  }
  if (volumeRef.value.contains(event.target)) {
    return;
  }
  clearVolumeTimer();
  volumeOpen.value = false;
}

function onVolumeInput(event) {
  const nextValue = parseFloat(event.target.value || '0');
  volume.value = nextValue;
  if (audioRef.value) {
    audioRef.value.volume = nextValue;
  }
  if (nextValue > 0 && muted.value) {
    muted.value = false;
    if (audioRef.value) {
      audioRef.value.muted = false;
    }
  }
}

function handleVolumeInput(event) {
  onVolumeInput(event);
  keepVolumeOpen();
}

function toggleMute() {
  muted.value = !muted.value;
  if (audioRef.value) {
    audioRef.value.muted = muted.value;
  }
}

watch(
  () => props.selectedTrack,
  async (value) => {
    albumArtOk.value = Boolean(value?.albumKey);
    currentTime.value = 0;
    duration.value = value?.duration || 0;
    await nextTick();
    if (audioRef.value) {
      audioRef.value.volume = volume.value;
      audioRef.value.muted = muted.value;
      if (props.autoPlay && value) {
        audioRef.value.play().catch(() => {});
      }
      if (!value) {
        audioRef.value.pause();
      }
    }
  }
);

onMounted(() => {
  document.addEventListener('pointerdown', handleGlobalPointer);
  if (props.autoPlayOnMount && props.autoPlay && props.selectedTrack) {
    nextTick(() => {
      audioRef.value?.play().catch(() => {});
    });
  }
});

onUnmounted(() => {
  clearVolumeTimer();
  document.removeEventListener('pointerdown', handleGlobalPointer);
});
</script>

<template>
  <div :class="['player-bar', { 'mini-player': isEmbedded }]">
    <div class="player-bar-left">
      <div class="player-bar-art">
        <img
          v-if="selectedTrack?.albumKey && albumArtOk"
          :src="albumArtUrl(selectedRootId, selectedTrack.albumKey)"
          :alt="trackAlbum(selectedTrack)"
          @error="albumArtOk = false"
        />
        <div v-else class="tile-fallback"><i class="fa-solid fa-compact-disc"></i></div>
      </div>
      <div class="player-bar-info">
        <div class="player-bar-title">
          {{ selectedTrack ? trackTitle(selectedTrack) : 'Nothing playing' }}
        </div>
        <div class="meta" v-if="selectedTrack">
          {{ trackAlbum(selectedTrack) }}
        </div>
        <div class="meta" v-if="selectedTrack">
          {{ trackArtist(selectedTrack) }}
        </div>
      </div>
    </div>
    <div class="player-bar-middle">
      <div class="player-bar-seek">
        <span>{{ formatTime(currentTime) }}</span>
        <input
          type="range"
          min="0"
          :max="seekMax"
          step="0.1"
          :value="currentTime"
          @input="onSeek"
          :disabled="!selectedTrack || !seekMax"
        />
        <span>{{ formatTime(effectiveDuration) }}</span>
      </div>
    </div>
    <div class="player-bar-right">
      <div class="player-bar-buttons">
        <button class="icon-btn" @click="playPrev" :disabled="!selectedTrack" aria-label="Previous">
          <i class="fa-solid fa-backward-step"></i>
        </button>
        <button class="icon-btn" @click="togglePlay" :disabled="!selectedTrack" aria-label="Play/pause">
          <i :class="isPlaying ? 'fa-solid fa-pause' : 'fa-solid fa-play'"></i>
        </button>
        <button class="icon-btn" @click="playNext" :disabled="!selectedTrack" aria-label="Next">
          <i class="fa-solid fa-forward-step"></i>
        </button>
      </div>
      <div
        class="player-bar-volume"
        :class="{ 'volume-active': volumeOpen }"
        ref="volumeRef"
        @mouseenter="openVolume"
        @mouseleave="closeVolume"
        @focusin="openVolume"
        @focusout="handleVolumeFocusOut"
        @pointerdown="openVolume"
        @pointermove="keepVolumeOpen"
      >
        <button class="icon-btn" @click="toggleMute" :disabled="!selectedTrack" aria-label="Mute">
          <i :class="muted || volume === 0 ? 'fa-solid fa-volume-xmark' : 'fa-solid fa-volume-high'"></i>
        </button>
        <div class="volume-popover">
          <input
            class="volume-slider"
            type="range"
            min="0"
            max="1"
            step="0.01"
            :value="volume"
            @input="handleVolumeInput"
            :disabled="!selectedTrack"
            aria-label="Volume"
          />
        </div>
      </div>
    </div>
    <audio
      ref="audioRef"
      :src="selectedTrack ? fileUrl(trackRootId(selectedTrack), selectedTrack.path) : ''"
      preload="metadata"
      @timeupdate="onTimeUpdate"
      @loadedmetadata="onLoadedMetadata"
      @durationchange="onDurationChange"
      @play="onPlay"
      @pause="onPause"
      @ended="onEnded"
    ></audio>
  </div>
</template>
