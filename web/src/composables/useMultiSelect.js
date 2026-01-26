import { ref } from 'vue';

export function useMultiSelect({ getItems, getKey }) {
  const selectedKeys = ref([]);
  const anchorKey = ref(null);

  function normalizeKey(item) {
    return item ? getKey(item) : '';
  }

  function clearSelection() {
    selectedKeys.value = [];
    anchorKey.value = null;
  }

  function setSingleSelection(item) {
    const key = normalizeKey(item);
    if (!key) {
      return;
    }
    selectedKeys.value = [key];
    anchorKey.value = key;
  }

  function toggleSelection(item) {
    const key = normalizeKey(item);
    if (!key) {
      return;
    }
    if (selectedKeys.value.includes(key)) {
      selectedKeys.value = selectedKeys.value.filter((value) => value !== key);
    } else {
      selectedKeys.value = [...selectedKeys.value, key];
    }
    anchorKey.value = key;
  }

  function selectRange(item, { additive = false } = {}) {
    const key = normalizeKey(item);
    if (!key) {
      return;
    }
    const list = getItems?.() || [];
    const anchor = anchorKey.value || key;
    const startIndex = list.findIndex((entry) => getKey(entry) === anchor);
    const endIndex = list.findIndex((entry) => getKey(entry) === key);
    const anchorValid = startIndex >= 0 && endIndex >= 0;
    const range = anchorValid
      ? list
          .slice(
            Math.min(startIndex, endIndex),
            Math.max(startIndex, endIndex) + 1
          )
          .map((entry) => getKey(entry))
      : [key];
    if (additive) {
      const merged = new Set(selectedKeys.value);
      range.forEach((value) => merged.add(value));
      selectedKeys.value = Array.from(merged);
    } else {
      selectedKeys.value = range;
    }
    if (!anchorKey.value || !anchorValid) {
      anchorKey.value = anchorValid ? anchor : key;
    }
  }

  function isSelected(item) {
    const key = normalizeKey(item);
    return selectedKeys.value.includes(key);
  }

  return {
    selectedKeys,
    anchorKey,
    clearSelection,
    setSingleSelection,
    toggleSelection,
    selectRange,
    isSelected,
  };
}
