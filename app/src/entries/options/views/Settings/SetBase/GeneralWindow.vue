<script setup lang="ts">
import { useTemplateRef } from "vue";

import UiWindow from "./UiWindow.vue";

const uiWindow = useTemplateRef<{ beforeSave?: () => Promise<void> | void }>("uiWindow");
async function beforeSave() {
  await uiWindow.value?.beforeSave?.();
}
defineExpose({ beforeSave });
</script>

<template>
  <UiWindow ref="uiWindow" />
</template>
