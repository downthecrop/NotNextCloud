<script setup>
const props = defineProps({
  active: {
    type: Boolean,
    default: false,
  },
  icon: {
    type: String,
    default: '',
  },
  count: {
    type: [Number, String],
    default: null,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
  ariaLabel: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['click']);

function handleClick(event) {
  if (props.disabled) {
    return;
  }
  emit('click', event);
}
</script>

<template>
  <button
    class="sidebar-item sidebar-nav-item"
    type="button"
    :class="{ active, disabled }"
    :disabled="disabled"
    :aria-label="ariaLabel || undefined"
    @click="handleClick"
  >
    <span v-if="icon" class="icon"><i :class="icon"></i></span>
    <span class="sidebar-label"><slot></slot></span>
    <slot name="suffix"></slot>
    <span v-if="!$slots.suffix && count !== null" class="sidebar-count">{{ count }}</span>
  </button>
</template>
