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

  function addPinPath(pathValue, { idPrefix = 'pin' } = {}) {
    const normalized = normalizePath(pathValue);
    if (pins.value.some((pin) => pin.path === normalized)) {
      return false;
    }
    pins.value = [
      ...pins.value,
      {
        id: `${idPrefix}-${Date.now()}`,
        path: normalized,
        label: pinLabel(normalized),
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
    };
    activePin.value = next;
    return next;
  }

  function selectPin(pin) {
    activePin.value = pin || null;
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
    clearPin,
  };
}
