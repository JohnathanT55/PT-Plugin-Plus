<script setup lang="ts">
import { computed, useAttrs } from "vue";

defineOptions({ inheritAttrs: false });

const props = defineProps<{
  title: string;
  label?: string;
  icon: string;
  color?: string;
  loading?: boolean;
  disabled?: boolean;
  status?: "idle" | "success" | "error";
}>();

const attrs = useAttrs();
const iconName = computed(() =>
  props.loading
    ? "mdi-loading"
    : props.status === "success"
      ? "mdi-check-circle-outline"
      : props.status === "error"
        ? "mdi-alert-circle-outline"
        : props.icon,
);
</script>

<template>
  <button
    v-bind="attrs"
    class="ptpp-toolbar-button"
    :class="{
      'ptpp-toolbar-button-success': status === 'success',
      'ptpp-toolbar-button-error': status === 'error',
    }"
    type="button"
    :disabled="disabled || loading"
    :title="title"
    :aria-label="title"
  >
    <v-icon :class="{ 'ptpp-toolbar-icon-loading': loading }" :icon="iconName" size="34" />
    <span>{{ label ?? title }}</span>
  </button>
</template>

<style scoped lang="scss">
.ptpp-toolbar-button {
  appearance: none;
  align-items: center;
  background: transparent;
  border: 0;
  color: #1976d2;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  font:
    12px/1.25 Arial,
    "Microsoft YaHei",
    sans-serif;
  justify-content: center;
  height: 50px;
  padding: 3px 4px;
  position: relative;
  text-align: center;
  width: 100%;

  &::before {
    border-top: 1px dotted #c8d3dc;
    content: "";
    left: 7px;
    position: absolute;
    right: 7px;
    top: 0;
  }

  &.ptpp-toolbar-button-success {
    color: #2e7d32;
  }

  &.ptpp-toolbar-button-error {
    color: #c62828;
  }

  &:hover:not(:disabled),
  &:focus-visible:not(:disabled) {
    background: rgba(77, 154, 231, 0.18);
    outline: none;
  }

  &:disabled {
    cursor: not-allowed;
    opacity: 0.42;
  }

  > span {
    margin-top: 2px;
    overflow-wrap: anywhere;
  }
}

.ptpp-toolbar-icon-loading {
  animation: ptpp-toolbar-spin 1s linear infinite;
}

@keyframes ptpp-toolbar-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
