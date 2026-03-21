import { computed, ref } from 'vue';
import { normalizePath, parentPath, pathLabel } from '../utils/pathing';
import { readJsonArray, writeJson } from '../utils/storage';

export function usePinnedLocations({ storageKey }) {
  const pins = ref([]);
  const activePin = ref(null);
  const activePinPath = computed(() => activePin.value?.path || '');

  function pinLabel(pathValue) {
    return pathLabel(pathValue, 'Root');
  }

  function persistPins() {
    writeJson(storageKey, pins.value);
  }

  function loadPins() {
    pins.value = readJsonArray(storageKey);
  }

  function addPinPath(pathValue, { idPrefix = 'pin', rootId = '', label = '', meta = {} } = {}) {
    const normalized = normalizePath(pathValue);
    const normalizedRootId = typeof rootId === 'string' ? rootId : '';
    const albumKey = typeof meta?.albumKey === 'string' ? meta.albumKey : '';
    if (
      pins.value.some((pin) =>
        albumKey
          ? pin.albumKey === albumKey && (pin.rootId || '') === normalizedRootId
          : pin.path === normalized && (pin.rootId || '') === normalizedRootId
      )
    ) {
      return false;
    }
    pins.value = [
      ...pins.value,
      {
        id: `${idPrefix}-${Date.now()}`,
        rootId: normalizedRootId,
        path: normalized,
        label: label || pinLabel(normalized),
        ...meta,
      },
    ];
    persistPins();
    return true;
  }

  function addPinForItemPath(filePath, options = {}) {
    return addPinPath(parentPath(filePath), options);
  }

  function setActivePinFromPath(pathValue, { idPrefix = 'pin', token = Date.now() } = {}) {
    const normalized = normalizePath(pathValue);
    if (!normalized) {
      activePin.value = null;
      return null;
    }
    const next = {
      id: `${idPrefix}-${token}`,
      path: normalized,
      label: pinLabel(normalized),
      kind: 'path',
    };
    activePin.value = next;
    return next;
  }

  function selectPin(pin) {
    activePin.value = pin || null;
  }

  function removePin(pinId) {
    if (!pinId) {
      return;
    }
    pins.value = pins.value.filter((pin) => pin.id !== pinId);
    if (activePin.value?.id === pinId) {
      activePin.value = null;
    }
    persistPins();
  }

  function clearPin() {
    activePin.value = null;
  }

  return {
    pins,
    activePin,
    activePinPath,
    pinLabel,
    loadPins,
    addPinPath,
    addPinForItemPath,
    setActivePinFromPath,
    selectPin,
    removePin,
    clearPin,
  };
}
