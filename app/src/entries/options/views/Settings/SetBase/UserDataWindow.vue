<script setup lang="ts">
import { useTemplateRef } from "vue";

import UserInfoWindow from "./UserInfoWindow.vue";

const userInfoWindow = useTemplateRef<{
  beforeSave?: () => Promise<void> | void;
  afterSave?: () => Promise<void> | void;
}>("userInfoWindow");

async function beforeSave() {
  await userInfoWindow.value?.beforeSave?.();
}

async function afterSave() {
  await userInfoWindow.value?.afterSave?.();
}

defineExpose({ beforeSave, afterSave });
</script>

<template>
  <UserInfoWindow ref="userInfoWindow" />
</template>
