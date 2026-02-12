import { onMounted, onUnmounted, ref, watch } from 'vue';

export function useMediaModal({ getItems, getItemKey, onSelect }) {
  const modalOpen = ref(false);
  const modalItem = ref(null);
  const zoomLevel = ref(1);

  const keyFor = (item) => {
    if (!item) {
      return '';
    }
    if (typeof getItemKey === 'function') {
      return String(getItemKey(item) || '');
    }
    return String(item.path || '');
  };

  function closeModal() {
    modalOpen.value = false;
  }

  function setModalItem(item) {
    if (!item) {
      return;
    }
    modalItem.value = item;
    zoomLevel.value = 1;
    onSelect?.(item);
  }

  function openModal(item) {
    if (!item) {
      return;
    }
    setModalItem(item);
    modalOpen.value = true;
  }

  function navigateModal(delta) {
    const list = (typeof getItems === 'function' ? getItems() : []) || [];
    if (!modalItem.value || !list.length) {
      return;
    }
    const currentKey = keyFor(modalItem.value);
    const index = list.findIndex((entry) => keyFor(entry) === currentKey);
    if (index < 0) {
      return;
    }
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= list.length) {
      return;
    }
    setModalItem(list[nextIndex]);
  }

  function zoomIn() {
    zoomLevel.value = Math.min(3, zoomLevel.value + 0.25);
  }

  function zoomOut() {
    zoomLevel.value = Math.max(1, zoomLevel.value - 0.25);
  }

  function handleKey(event) {
    if (!modalOpen.value) {
      return;
    }
    if (event.key === 'Escape') {
      closeModal();
    } else if (event.key === 'ArrowRight') {
      navigateModal(1);
    } else if (event.key === 'ArrowLeft') {
      navigateModal(-1);
    } else if (event.key === '+' || event.key === '=') {
      zoomIn();
    } else if (event.key === '-') {
      zoomOut();
    }
  }

  watch(modalOpen, (value) => {
    document.body.style.overflow = value ? 'hidden' : '';
  });

  onMounted(() => {
    window.addEventListener('keydown', handleKey);
  });

  onUnmounted(() => {
    window.removeEventListener('keydown', handleKey);
    document.body.style.overflow = '';
  });

  return {
    modalOpen,
    modalItem,
    zoomLevel,
    openModal,
    closeModal,
    setModalItem,
    navigateModal,
    zoomIn,
    zoomOut,
  };
}
