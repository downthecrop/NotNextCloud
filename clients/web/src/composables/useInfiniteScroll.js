import { ref, onMounted, onUnmounted, watch } from 'vue';

export function useInfiniteScroll(onLoadMore, options = {}) {
  const sentinel = ref(null);
  const canLoadMore =
    typeof options.canLoadMore === 'function' ? options.canLoadMore : () => true;
  const autoRepeat = options.autoRepeat === true;
  const rootRef = options.rootRef || null;
  const rootMargin = options.rootMargin || '240px 0px 240px 0px';
  let observer = null;
  let loadInFlight = false;
  let sentinelIntersecting = false;
  let retryScheduled = false;

  const scheduleRetry = () => {
    if (retryScheduled) {
      return;
    }
    retryScheduled = true;
    Promise.resolve().then(() => {
      retryScheduled = false;
      triggerLoadMore();
    });
  };

  const triggerLoadMore = () => {
    if (loadInFlight || !canLoadMore()) {
      return;
    }
    loadInFlight = true;
    Promise.resolve()
      .then(() => onLoadMore?.())
      .finally(() => {
        loadInFlight = false;
        if (autoRepeat && sentinelIntersecting && canLoadMore()) {
          scheduleRetry();
        }
      });
  };

  const createObserver = () => {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.target !== sentinel.value) {
            continue;
          }
          sentinelIntersecting = entry.isIntersecting;
          if (entry.isIntersecting) {
            triggerLoadMore();
          }
        }
      },
      {
        root: rootRef?.value || null,
        rootMargin,
      }
    );
    if (sentinel.value) {
      observer.observe(sentinel.value);
    }
  };

  onMounted(() => {
    createObserver();
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
    sentinelIntersecting = false;
    if (oldValue) {
      observer.unobserve(oldValue);
    }
    if (value) {
      observer.observe(value);
    }
  });

  if (rootRef) {
    watch(rootRef, () => {
      sentinelIntersecting = false;
      createObserver();
    });
  }

  return { sentinel };
}
