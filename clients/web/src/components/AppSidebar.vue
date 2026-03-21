<script setup>
defineProps({
  title: {
    type: String,
    default: '',
  },
});
</script>

<template>
  <aside class="sidebar app-sidebar">
    <div v-if="title || $slots.header" class="sidebar-header">
      <h3 v-if="title">{{ title }}</h3>
      <slot name="header"></slot>
    </div>
    <div class="sidebar-content">
      <slot></slot>
    </div>
    <slot name="footer"></slot>
  </aside>
</template>
