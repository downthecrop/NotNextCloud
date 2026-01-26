import { ref, onMounted, onUnmounted, watch } from 'vue';

export function useInfiniteScroll(onLoadMore) {
  const sentinel = ref(null);
  let observer = null;

  onMounted(() => {
    observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        onLoadMore();
      }
    });
    if (sentinel.value) {
      observer.observe(sentinel.value);
    }
  });

  onUnmounted(() => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
  });

  watch(sentinel, (value, oldValue) => {
    if (!observer) {
      return;
    }
    if (oldValue) {
      observer.unobserve(oldValue);
    }
    if (value) {
      observer.observe(value);
    }
  });

  return { sentinel };
}
