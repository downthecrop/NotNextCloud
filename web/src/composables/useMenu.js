import { ref, onMounted, onUnmounted } from 'vue';

export function useMenu(defaultPayload = {}) {
  const makeState = (overrides = {}) => ({
    open: false,
    x: 0,
    y: 0,
    ...defaultPayload,
    ...overrides,
  });
  const menu = ref(makeState());
  const closeMenu = () => {
    menu.value = makeState();
  };
  const openMenu = (event, payload = {}) => {
    menu.value = makeState({
      ...payload,
      open: true,
      x: event.clientX,
      y: event.clientY,
    });
  };
  return { menu, openMenu, closeMenu };
}

export function useGlobalMenuClose(handlers) {
  const closeHandlers = Array.isArray(handlers) ? handlers : [handlers];
  const closeAll = () => {
    closeHandlers.forEach((handler) => handler?.());
  };
  onMounted(() => {
    window.addEventListener('click', closeAll);
    window.addEventListener('scroll', closeAll, true);
  });
  onUnmounted(() => {
    window.removeEventListener('click', closeAll);
    window.removeEventListener('scroll', closeAll, true);
  });
  return { closeAll };
}
