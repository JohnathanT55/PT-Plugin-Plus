<script setup lang="ts">
import { computed, useAttrs } from "vue";
import { useI18n } from "vue-i18n";

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
const { locale } = useI18n({ useScope: "global" });
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
      'ptpp-toolbar-button-en': locale === 'en',
    }"
    type="button"
    :disabled="disabled || loading"
    :title="title"
    :aria-label="title"
  >
    <v-icon :class="{ 'ptpp-toolbar-icon-loading': loading }" :icon="iconName" />
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
    12px/1.3 Arial,
    "Microsoft YaHei",
    sans-serif;
  justify-content: center;
  height: var(--ptpp-toolbar-button-height, 60px);
  min-height: 44px;
  padding: 6px 8px;
  position: relative;
  text-align: center;
  width: 100%;

  &::before {
    border-top: 1px dotted #c8d3dc;
    content: "";
    left: 10px;
    position: absolute;
    right: 10px;
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
    display: block;
    margin-top: 3px;
    max-width: 100%;
    overflow-wrap: break-word;
    word-break: keep-all;
  }

  :deep(.v-icon) {
    flex: 0 0 auto;
    font-size: 32px;
  }

  &.ptpp-toolbar-button-en {
    font-size: 11px;
    line-height: 1.18;
    padding: 4px 6px;

    > span {
      margin-top: 2px;
    }

    :deep(.v-icon) {
      font-size: 30px;
    }
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

@media (max-height: 700px), (max-width: 520px) {
  .ptpp-toolbar-button {
    font-size: 11px;
    height: var(--ptpp-toolbar-compact-button-height, 48px);
    padding: 3px 5px;

    &::before {
      left: 8px;
      right: 8px;
    }

    > span {
      margin-top: 1px;
    }

    :deep(.v-icon) {
      font-size: 27px;
    }

    &.ptpp-toolbar-button-en {
      font-size: 10px;
      padding: 2px 4px;

      :deep(.v-icon) {
        font-size: 25px;
      }
    }
  }
}
</style>
