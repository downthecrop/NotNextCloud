import { ref } from 'vue';
import { readJsonArray, readPositiveInt, writeJson } from '../utils/storage';

export function useDraftCollection({
  storageKey,
  counterKey,
  itemField = 'items',
  idPrefix = 'draft',
  namePrefix = 'New Item',
}) {
  const entries = ref([]);
  const counter = ref(1);

  function persistEntries() {
    writeJson(storageKey, entries.value);
    localStorage.setItem(counterKey, String(counter.value));
  }

  function loadEntries() {
    entries.value = readJsonArray(storageKey);
    counter.value = readPositiveInt(counterKey, 1);
  }

  function ensureDraftEntry() {
    let draft = entries.value.find((entry) => entry?.isDraft);
    if (!draft) {
      draft = {
        id: `${idPrefix}-${Date.now()}`,
        name: `${namePrefix} #${counter.value}`,
        [itemField]: [],
        isDraft: true,
      };
      counter.value += 1;
      entries.value = [draft, ...entries.value];
    }
    return draft;
  }

  function removeEntry(entryId) {
    if (!entryId) {
      return false;
    }
    const nextEntries = entries.value.filter((entry) => entry?.id !== entryId);
    if (nextEntries.length === entries.value.length) {
      return false;
    }
    entries.value = nextEntries;
    return true;
  }

  return {
    entries,
    persistEntries,
    loadEntries,
    ensureDraftEntry,
    removeEntry,
  };
}
