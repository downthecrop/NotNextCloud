import { ref } from 'vue';

export function useSort({ initialKey = '', initialDir = 'asc' } = {}) {
  const sortKey = ref(initialKey);
  const sortDir = ref(initialDir);

  const setSort = (nextKey) => {
    if (sortKey.value === nextKey) {
      sortDir.value = sortDir.value === 'asc' ? 'desc' : 'asc';
      return;
    }
    sortKey.value = nextKey;
    sortDir.value = 'asc';
  };

  const compareText = (a, b) =>
    String(a || '').localeCompare(String(b || ''), undefined, { sensitivity: 'base' });

  const sortList = (list, { getValue, numericKeys = [], tieBreak } = {}) => {
    if (!sortKey.value || !Array.isArray(list) || !list.length) {
      return list;
    }
    const key = sortKey.value;
    const direction = sortDir.value === 'desc' ? -1 : 1;
    const numericSet = Array.isArray(numericKeys) ? new Set(numericKeys) : numericKeys;
    const isNumeric = numericSet instanceof Set ? numericSet.has(key) : false;
    return [...list].sort((a, b) => {
      const valueA = getValue?.(a, key);
      const valueB = getValue?.(b, key);
      let diff = 0;
      if (isNumeric) {
        diff = (Number(valueA) || 0) - (Number(valueB) || 0);
      } else {
        diff = compareText(valueA, valueB);
      }
      if (diff !== 0) {
        return diff * direction;
      }
      if (tieBreak) {
        return tieBreak(a, b) * direction;
      }
      return 0;
    });
  };

  return {
    sortKey,
    sortDir,
    setSort,
    sortList,
    compareText,
  };
}
