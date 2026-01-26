import { ref } from 'vue';

export function useImageErrors({ getKey } = {}) {
  const errors = ref({});

  const buildKey = (item, variant) => {
    const baseKey = getKey ? getKey(item) : item?.path || '';
    return `${baseKey}:${variant || ''}`;
  };

  const hasImageError = (item, variant) => Boolean(errors.value[buildKey(item, variant)]);

  const markImageError = (item, variant) => {
    const key = buildKey(item, variant);
    errors.value = { ...errors.value, [key]: true };
  };

  const resetImageErrors = () => {
    errors.value = {};
  };

  return {
    hasImageError,
    markImageError,
    resetImageErrors,
  };
}
