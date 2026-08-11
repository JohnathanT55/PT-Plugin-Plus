<script setup lang="ts">
import { useDisplay } from "vuetify/framework";

const display = useDisplay();

const { disabled = false, ...props } = defineProps<{
  icon: string;
  text: string;
  disabled?: boolean;
}>();
</script>

<template>
  <v-btn
    v-bind="$attrs"
    :class="['ptpp-toolbar-button', { 'nav-button-full': !display.smAndDown.value }]"
    :icon="display.smAndDown.value"
    :prepend-icon="display.smAndDown.value ? undefined : props.icon"
    :rounded="display.smAndDown.value ? 0 : 4 /* default rounded */"
    :size="display.smAndDown.value ? 'small' : 'default'"
    :disabled="disabled"
    :title="props.text"
    :variant="display.smAndDown.value ? 'text' : 'elevated'"
  >
    <v-icon v-if="display.smAndDown.value" :icon="props.icon"></v-icon>
    <span v-else>{{ props.text }}</span>
  </v-btn>
</template>

<style scoped lang="scss">
.nav-button-full {
  align-self: center;
  box-sizing: border-box;
  flex: 0 0 auto;
  height: 36px !important;
  margin-block: 0 !important;
  max-height: 36px !important;
  min-height: 36px !important;
  position: relative !important;
  transform: none !important;
  vertical-align: middle;
}

/* Vuetify removes elevation from disabled buttons. Apply one shadow to every
 * toolbar button so enabled/disabled and theme colors have the same visual
 * baseline instead of making destructive actions look slightly raised. */
.nav-button-full.v-btn--variant-elevated {
  box-shadow:
    0 2px 2px rgba(0, 0, 0, 0.2),
    0 1px 5px rgba(0, 0, 0, 0.12) !important;
}

.ptpp-toolbar-button :deep(.v-btn__content) {
  align-items: center;
  height: 100%;
  line-height: 1;
  white-space: nowrap;
}

.nav-button-full + .nav-button-full {
  margin-left: 4px;
}
</style>
