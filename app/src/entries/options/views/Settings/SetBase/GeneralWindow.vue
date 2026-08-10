<script setup lang="ts">
import { useTemplateRef } from "vue";

import UiWindow from "./UiWindow.vue";
import UserInfoWindow from "./UserInfoWindow.vue";

const uiWindow = useTemplateRef<{ beforeSave?: () => Promise<void> | void }>("uiWindow");
const userInfoWindow = useTemplateRef<{ afterSave?: () => Promise<void> | void }>("userInfoWindow");

async function beforeSave() {
  await uiWindow.value?.beforeSave?.();
}

async function afterSave() {
  await userInfoWindow.value?.afterSave?.();
}

defineExpose({ beforeSave, afterSave });
</script>

<template>
  <UserInfoWindow ref="userInfoWindow" />
  <v-divider class="my-6" />
  <UiWindow ref="uiWindow" />
</template>
