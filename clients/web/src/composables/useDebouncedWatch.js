import { watch, onUnmounted } from 'vue';

export function useDebouncedWatch(source, callback, delay = 250) {
  let timer = null;
  const stop = watch(source, (...args) => {
    if (timer) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => callback(...args), delay);
  });
  onUnmounted(() => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  });
  return () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    stop();
  };
}
