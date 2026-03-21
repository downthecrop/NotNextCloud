<template>
  <div class="toolbar view-toolbar">
    <div class="toolbar-title">
      <slot name="title"></slot>
    </div>
    <div v-if="$slots.actions" class="toolbar-actions">
      <slot name="actions"></slot>
    </div>
  </div>
</template>
