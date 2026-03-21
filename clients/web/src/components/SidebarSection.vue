<script setup>
defineProps({
  title: {
    type: String,
    default: '',
  },
});
</script>

<template>
  <section class="sidebar-section">
    <div v-if="title" class="sidebar-title">{{ title }}</div>
    <slot></slot>
  </section>
</template>
