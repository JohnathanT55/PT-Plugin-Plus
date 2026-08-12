<script setup lang="ts">
defineProps<{
  title: string;
  icon?: string;
  description?: string;
}>();
</script>

<template>
  <v-card class="ptpp-settings-section" variant="outlined">
    <v-card-title class="d-flex align-center ga-2 px-5 pt-4 pb-2 text-subtitle-1 font-weight-medium">
      <v-icon v-if="icon" :icon="icon" color="primary" size="small" />
      <span>{{ title }}</span>
    </v-card-title>
    <v-card-subtitle v-if="description" class="px-5 pb-3 text-wrap">{{ description }}</v-card-subtitle>
    <v-divider />
    <v-card-text class="px-5 py-4">
      <slot />
    </v-card-text>
  </v-card>
</template>

<style scoped lang="scss">
.ptpp-settings-section {
  width: 100%;
  margin-bottom: 16px;
  border-color: rgba(var(--v-border-color), 0.28);
  background: rgb(var(--v-theme-surface));
}
</style>
