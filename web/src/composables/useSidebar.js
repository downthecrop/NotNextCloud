import { ref } from 'vue';

export function useSidebar() {
  const sidebarOpen = ref(false);

  function toggleSidebar() {
    sidebarOpen.value = !sidebarOpen.value;
  }

  function closeSidebar() {
    sidebarOpen.value = false;
  }

  return {
    sidebarOpen,
    toggleSidebar,
    closeSidebar,
  };
}
