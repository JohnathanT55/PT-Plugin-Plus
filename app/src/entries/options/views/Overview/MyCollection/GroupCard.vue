<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { ITorrent } from "@ptd/site";

import { formatSize } from "@/options/utils.ts";
import ActionTd from "@/options/views/Overview/SearchEntity/ActionTd.vue";

const props = defineProps<{
  id: string;
  name: string;
  description?: string;
  count: number;
  totalSize: number;
  color?: string;
  active: boolean;
  readOnly?: boolean;
  isDefault?: boolean;
  torrentItems: ITorrent[];
}>();

const emit = defineEmits<{
  (event: "select", id: string): void;
  (event: "edit", id: string): void;
  (event: "remove", id: string): void;
  (event: "toggle-default", id: string): void;
}>();

const { t } = useI18n();
const legacyColors: Record<string, string> = {
  red: "#c62828",
  pink: "#ad1457",
  purple: "#6a1b9a",
  "deep-purple": "#4527a0",
  indigo: "#283593",
  blue: "#1565c0",
  "light-blue": "#0277bd",
  cyan: "#00838f",
  teal: "#00695c",
  green: "#2e7d32",
  "light-green": "#558b2f",
  lime: "#827717",
  yellow: "#9e7c00",
  amber: "#ad6900",
  orange: "#ad4f00",
  "deep-orange": "#bf360c",
  brown: "#4e342e",
  "blue-grey": "#37474f",
  grey: "#455a64",
  black: "#263238",
};

const cardColor = computed(() => {
  const normalized = props.color?.toLowerCase().replace(/\s+(lighten|darken)-\d+$/, "") || "blue";
  return legacyColors[normalized] || legacyColors.blue;
});
</script>

<template>
  <article
    :class="['ptpp-collection-group', { 'ptpp-collection-group--active': active }]"
    :style="{ backgroundColor: cardColor }"
    :aria-current="active ? 'true' : undefined"
    tabindex="0"
    @click="emit('select', id)"
    @keydown.enter="emit('select', id)"
    @keydown.space.prevent="emit('select', id)"
  >
    <div class="ptpp-collection-group__summary">
      <div class="ptpp-collection-group__name" :title="name">
        <v-icon v-if="isDefault" icon="mdi-star" size="16" :title="t('MyCollection.defaultGroup')" />
        <span>{{ name }}</span>
      </div>
      <strong>{{ count }}</strong>
    </div>
    <div v-if="description" class="ptpp-collection-group__description" :title="description">{{ description }}</div>
    <div class="ptpp-collection-group__size">{{ formatSize(totalSize) }}</div>

    <div class="ptpp-collection-group__actions" @click.stop>
      <ActionTd
        :torrent-items="torrentItems"
        density="compact"
        :show-favorite-btn="false"
        :show-keep-upload-btn="false"
      />
      <template v-if="!readOnly">
        <v-btn
          :icon="isDefault ? 'mdi-star-off' : 'mdi-star-outline'"
          :title="isDefault ? t('MyCollection.cancelDefaultGroup') : t('MyCollection.setDefaultGroup')"
          size="small"
          variant="text"
          @click="emit('toggle-default', id)"
        />
        <v-btn icon="mdi-pencil" :title="t('common.edit')" size="small" variant="text" @click="emit('edit', id)" />
        <v-btn icon="mdi-delete" :title="t('common.remove')" size="small" variant="text" @click="emit('remove', id)" />
      </template>
    </div>
  </article>
</template>

<style scoped lang="scss">
.ptpp-collection-group {
  border: 2px solid transparent;
  border-radius: 3px;
  box-shadow: 0 2px 5px rgb(0 0 0 / 26%);
  color: #fff;
  cursor: pointer;
  display: grid;
  flex: 0 0 230px;
  gap: 2px;
  min-height: 96px;
  outline: none;
  padding: 8px 10px 5px;
  transition:
    box-shadow 120ms ease,
    transform 120ms ease;

  &:hover,
  &:focus-visible {
    box-shadow: 0 4px 10px rgb(0 0 0 / 36%);
    transform: translateY(-1px);
  }
}

.ptpp-collection-group--active {
  border-color: #fff;
  box-shadow:
    0 0 0 2px #1976d2,
    0 4px 10px rgb(0 0 0 / 36%);
}

.ptpp-collection-group__summary {
  align-items: center;
  display: grid;
  font-size: 17px;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
}

.ptpp-collection-group__name {
  align-items: center;
  display: flex;
  gap: 5px;
  min-width: 0;

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}

.ptpp-collection-group__size {
  font-size: 12px;
  opacity: 0.88;
}

.ptpp-collection-group__description {
  font-size: 12px;
  opacity: 0.88;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ptpp-collection-group__actions {
  align-items: center;
  display: flex;
  margin-left: -7px;
  margin-top: auto;
  min-height: 32px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 120ms ease;

  :deep(.v-btn) {
    color: #fff !important;
  }
}

.ptpp-collection-group:hover .ptpp-collection-group__actions,
.ptpp-collection-group:focus-within .ptpp-collection-group__actions {
  opacity: 1;
  pointer-events: auto;
}

@media (hover: none) {
  .ptpp-collection-group__actions {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
