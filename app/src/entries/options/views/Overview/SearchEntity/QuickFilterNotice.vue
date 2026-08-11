<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import { tableCustomFilter } from "./utils/filter.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();

const { advanceFilterDictRef, advanceItemPropsRef, updateTableFilterValueFn } = tableCustomFilter;

const selectedSite = ref<string>("");
const selectedTags = ref<string[]>([]);

// Build all quick-filter counts in one pass. Calling Array#filter once for
// every rendered site and tag multiplied the work by the number of filter
// buttons and made large result sets expensive to restore after navigation.
const resultCounts = computed(() => {
  const sites = new Map<string, number>();
  const tags = new Map<string, number>();

  for (const torrent of runtimeStore.search.searchResult) {
    if (torrent.site) {
      sites.set(torrent.site, (sites.get(torrent.site) ?? 0) + 1);
    }

    for (const tag of torrent.tags ?? []) {
      if (!tag.name) continue;
      tags.set(tag.name, (tags.get(tag.name) ?? 0) + 1);
    }
  }

  return { sites, tags };
});

const siteIds = computed<string[]>(() => advanceItemPropsRef.value.site ?? []);
const tagItems = computed<Array<{ name: string; color?: string }>>(() =>
  (advanceItemPropsRef.value.tags ?? [])
    .map((tag: string | { name: string; color?: string }) =>
      typeof tag === "string" ? { name: tag } : { name: tag.name, color: tag.color },
    )
    .filter((tag: { name: string }) => Boolean(tag.name)),
);
const fallbackTagColors = ["#607d8b", "#5c6bc0", "#00897b", "#7e57c2", "#c25b56", "#9a6a2f", "#3f7f45"];
const namedTagColors: Record<string, string> = {
  white: "#ffffff",
  black: "#000000",
  gray: "#808080",
  grey: "#808080",
  red: "#f44336",
  green: "#4caf50",
  blue: "#2196f3",
  yellow: "#ffeb3b",
  orange: "#ff9800",
  purple: "#9c27b0",
  pink: "#e91e63",
  cyan: "#00bcd4",
  teal: "#009688",
  indigo: "#3f51b5",
  brown: "#795548",
  lime: "#cddc39",
  amber: "#ffc107",
};

function parseTagColor(color?: string): [number, number, number] | null {
  let normalized = color?.trim().toLowerCase().replaceAll(" ", "") ?? "";
  if (!normalized) return null;
  normalized = namedTagColors[normalized] ?? normalized;

  const hexMatch = normalized.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (hexMatch) {
    let hex = hexMatch[1];
    if (hex.length === 3) hex = [...hex].map((character) => character + character).join("");
    const value = Number.parseInt(hex, 16);
    return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  }

  const rgbMatch = normalized.match(/^rgba?\((\d+),(\d+),(\d+)(?:,[\d.]+)?\)$/);
  if (!rgbMatch) return null;
  return [Number(rgbMatch[1]), Number(rgbMatch[2]), Number(rgbMatch[3])];
}

function colorLuminance([red, green, blue]: [number, number, number]) {
  const [r, g, b] = [red, green, blue].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function fallbackTagColor(tagName: string) {
  const hash = [...tagName].reduce((value, character) => value * 31 + character.codePointAt(0)!, 0);
  return fallbackTagColors[Math.abs(hash) % fallbackTagColors.length];
}

function tagFilterStyle(tagName: string, color?: string) {
  const parsedColor = parseTagColor(color);
  const unsafeColor = !parsedColor || colorLuminance(parsedColor) < 0.09 || colorLuminance(parsedColor) > 0.86;
  const background = unsafeColor ? fallbackTagColor(tagName) : color!;
  const textColor = colorLuminance(parseTagColor(background)!) > 0.55 ? "#263238" : "#fff";

  return {
    "--ptpp-tag-color": background,
    "--ptpp-tag-text": textColor,
    "--ptpp-tag-border": unsafeColor ? "rgba(0, 0, 0, 0.2)" : "transparent",
  };
}

function siteResultCount(siteId: string) {
  return resultCounts.value.sites.get(siteId) ?? 0;
}

function tagResultCount(tagName: string) {
  return resultCounts.value.tags.get(tagName) ?? 0;
}

function clearSiteFilter() {
  selectedSite.value = "";
  advanceFilterDictRef.value.site.required = [];
  advanceFilterDictRef.value.site.exclude = [];
  updateTableFilterValueFn();
}

function selectSite(siteId: string) {
  if (selectedSite.value === siteId) {
    clearSiteFilter();
    return;
  }

  selectedSite.value = siteId;
  advanceFilterDictRef.value.site.required = [siteId];
  advanceFilterDictRef.value.site.exclude = [];
  updateTableFilterValueFn();
}

function toggleTag(tagName: string) {
  selectedTags.value = selectedTags.value.includes(tagName)
    ? selectedTags.value.filter((name) => name !== tagName)
    : [...selectedTags.value, tagName];
  advanceFilterDictRef.value.tags.required = [...selectedTags.value];
  advanceFilterDictRef.value.tags.exclude = [];
  updateTableFilterValueFn();
}
</script>

<template>
  <div class="ptpp-quick-filters">
    <div v-if="configStore.searchEntity.quickSiteFilter && siteIds.length" class="ptpp-filter-row">
      <button
        type="button"
        :class="['ptpp-filter-button', 'ptpp-site-filter', { 'is-active': selectedSite === '' }]"
        @click="clearSiteFilter"
      >
        <v-icon icon="mdi-web" size="14" />
        <span>{{ t("SearchEntity.siteFilter.all") }}</span>
        <span class="ptpp-filter-count">{{ runtimeStore.search.searchResult.length }}</span>
      </button>

      <button
        v-for="siteId in siteIds"
        :key="siteId"
        type="button"
        :class="['ptpp-filter-button', 'ptpp-site-filter', { 'is-active': selectedSite === siteId }]"
        @click="selectSite(siteId)"
      >
        <SiteFavicon :site-id="siteId" :size="14" />
        <SiteName :site-id="siteId" tag="span" />
        <span class="ptpp-filter-count">{{ siteResultCount(siteId) }}</span>
      </button>
    </div>

    <div v-if="configStore.searchEntifyControl.showTorrentTag && tagItems.length" class="ptpp-filter-row ptpp-tag-row">
      <button
        v-for="tag in tagItems"
        :key="tag.name"
        type="button"
        :class="['ptpp-filter-button', 'ptpp-tag-filter', { 'is-active': selectedTags.includes(tag.name) }]"
        :style="tagFilterStyle(tag.name, tag.color)"
        @click="toggleTag(tag.name)"
      >
        <span>{{ tag.name }}</span>
        <span class="ptpp-filter-count">{{ tagResultCount(tag.name) }}</span>
      </button>
    </div>
  </div>
</template>

<style lang="scss" scoped>
.ptpp-quick-filters {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.ptpp-filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ptpp-filter-button {
  align-items: center;
  border: 0;
  border-radius: 2px;
  color: #fff;
  cursor: pointer;
  display: inline-flex;
  font: inherit;
  font-size: 12px;
  gap: 4px;
  height: 28px;
  opacity: 0.72;
  padding: 0 4px 0 6px;
  transition:
    box-shadow 0.15s ease,
    opacity 0.15s ease;
  white-space: nowrap;

  &:hover,
  &.is-active {
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35);
    opacity: 1;
  }
}

.ptpp-site-filter {
  background: #455a64;
}

.ptpp-tag-filter {
  background: var(--ptpp-tag-color);
  border: 1px solid var(--ptpp-tag-border);
  color: var(--ptpp-tag-text);
}

.ptpp-filter-count {
  align-items: center;
  align-self: stretch;
  background: rgba(0, 0, 0, 0.2);
  display: inline-flex;
  margin-left: 2px;
  min-width: 22px;
  padding-inline: 6px;
  justify-content: center;
}
</style>
