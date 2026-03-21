<script setup>
import { ref } from 'vue';

const scrollEl = ref(null);

defineExpose({
  scrollEl,
});
</script>

<template>
  <div ref="scrollEl" class="browser-scroll">
    <slot></slot>
  </div>
</template>
