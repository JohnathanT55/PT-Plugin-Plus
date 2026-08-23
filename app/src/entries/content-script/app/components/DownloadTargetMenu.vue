<script setup lang="ts">
import { computed, inject, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { ITorrent } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { buildSiteDownloadMenuTargets, type DownloadMenuTarget } from "@/shared/downloadTarget.ts";
import { sendTorrentToDownloader } from "@/options/components/SentToDownloaderDialog/utils.ts";

import type { IPtdData } from "../utils.ts";
import SpeedDialBtn from "./SpeedDialBtn.vue";

const props = defineProps<{
  title: string;
  icon?: string;
  loadTorrents: () => Promise<ITorrent[]>;
}>();

const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();
const ptdData = inject<IPtdData>("ptd_data", {});
const { t } = useI18n();

const showMenu = ref(false);
const loading = ref(false);
const status = ref<"idle" | "success" | "error">("idle");
const menuAnchor = ref<HTMLElement>();
const menuElement = ref<HTMLElement>();
const menuShiftY = ref(0);
const torrents = ref<ITorrent[]>([]);
const targets = computed(() => buildSiteDownloadMenuTargets(metadataStore, ptdData.siteId));
const firstGeneralIndex = computed(() => targets.value.findIndex((target) => target.kind === "general"));
const dockSide = computed(() => (configStore.contentScript.dockSide === "left" ? "left" : "right"));

function targetTitle(target: DownloadMenuTarget): string {
  const parts = [target.downloader.name, target.downloader.address];
  if (target.savePath) parts.push(target.savePath);
  if (target.label) parts.push(`#${target.label}`);
  return parts.filter(Boolean).join(" → ");
}

async function openTargetMenu() {
  if (showMenu.value) {
    showMenu.value = false;
    return;
  }
  if (targets.value.length === 0) {
    runtimeStore.showSnakebar(t("contentScript.noAvailableDownloadTarget"), { color: "warning" });
    return;
  }

  loading.value = true;
  try {
    torrents.value = await props.loadTorrents();
    if (torrents.value.length === 0) {
      runtimeStore.showSnakebar(t("contentScript.noTorrentParsed"), { color: "error" });
      return;
    }
    showMenu.value = true;
    await nextTick();
    adjustMenuToViewport();
    menuAnchor.value?.querySelector<HTMLElement>(".ptpp-download-target-item")?.focus();
  } catch (error) {
    status.value = "error";
    runtimeStore.showSnakebar(`${t("contentScript.parsePageFailed")}: ${String(error)}`, { color: "error" });
    window.setTimeout(() => (status.value = "idle"), 2000);
  } finally {
    loading.value = false;
  }
}

function adjustMenuToViewport() {
  menuShiftY.value = 0;
  void nextTick(() => {
    const bounds = menuElement.value?.getBoundingClientRect();
    if (!bounds) return;
    const viewportHeight = window.visualViewport?.height || window.innerHeight;
    const margin = 8;
    if (bounds.top < margin) menuShiftY.value = margin - bounds.top;
    else if (bounds.bottom > viewportHeight - margin) menuShiftY.value = viewportHeight - margin - bounds.bottom;
  });
}

defineExpose({ openTargetMenu });

function closeOnOutsidePointer(event: Event) {
  if (showMenu.value && menuAnchor.value && !event.composedPath().includes(menuAnchor.value)) {
    showMenu.value = false;
  }
}

function closeOnEscape(event: KeyboardEvent) {
  if (showMenu.value && event.key === "Escape") {
    event.preventDefault();
    showMenu.value = false;
    menuAnchor.value?.querySelector<HTMLElement>(".ptpp-toolbar-button")?.focus();
  }
}

onMounted(() => {
  // The toolbar lives in a shadow root. Listen above that boundary so clicks
  // on the tracker page and Escape both close the anchored menu.
  document.addEventListener("pointerdown", closeOnOutsidePointer, true);
  window.addEventListener("keydown", closeOnEscape, true);
  window.addEventListener("resize", adjustMenuToViewport, true);
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  window.removeEventListener("keydown", closeOnEscape, true);
  window.removeEventListener("resize", adjustMenuToViewport, true);
});

async function selectTarget(target: DownloadMenuTarget) {
  showMenu.value = false;
  loading.value = true;
  try {
    const summary = await sendTorrentToDownloader(torrents.value, target.downloaderId, {
      localDownload: true,
      addAtPaused: !target.autoStart,
      savePath: target.savePath,
      label: target.label,
      uploadSpeedLimit: 0,
      advanceAddTorrentOptions: target.downloader.advanceAddTorrentOptions ?? {},
    });
    status.value = summary.failedCount === 0 && summary.totalCount > 0 ? "success" : "error";
  } catch {
    status.value = "error";
  } finally {
    loading.value = false;
    window.setTimeout(() => (status.value = "idle"), 2000);
  }
}
</script>

<template>
  <div ref="menuAnchor" class="ptpp-download-target-anchor">
    <SpeedDialBtn
      :disabled="targets.length === 0"
      :icon="icon ?? 'mdi-cloud-download'"
      :label="title"
      :loading="loading"
      :status="status"
      :title="title"
      aria-haspopup="menu"
      :aria-expanded="showMenu"
      @click="openTargetMenu"
    />

    <div
      v-if="showMenu"
      ref="menuElement"
      class="ptpp-download-target-menu"
      :class="`ptpp-download-target-menu--dock-${dockSide}`"
      :style="{ '--ptpp-menu-shift-y': `${menuShiftY}px` }"
      role="menu"
      :aria-label="title"
    >
      <template
        v-for="(target, index) in targets"
        :key="`${target.kind}-${target.downloaderId}-${target.savePath}-${target.label}`"
      >
        <div v-if="index === firstGeneralIndex && firstGeneralIndex > 0" class="ptpp-download-target-divider" />
        <button
          class="ptpp-download-target-item"
          type="button"
          role="menuitem"
          :title="targetTitle(target)"
          @click="selectTarget(target)"
        >
          <v-icon :icon="target.kind === 'site' ? 'mdi-folder-star' : 'mdi-download-network'" size="25" />
          <span class="ptpp-download-target-copy">
            <strong>{{ target.downloader.name }}</strong>
            <span class="ptpp-download-target-address">{{ target.downloader.address }}</span>
            <span class="ptpp-download-target-path">
              {{ target.savePath || t("contentScript.downloaderRootDirectory") }}
              <template v-if="target.label"> · #{{ target.label }}</template>
            </span>
          </span>
        </button>
      </template>
    </div>
  </div>
</template>

<style scoped lang="scss">
.ptpp-download-target-anchor {
  position: relative;
  width: 100%;
}

.ptpp-download-target-menu {
  background: #f3f8fc;
  border: 1px solid #b9d4e8;
  border-radius: 4px;
  box-shadow: 0 5px 15px rgba(0, 0, 0, 0.28);
  color: #194f77;
  display: flex;
  flex-direction: column;
  max-height: min(70vh, 560px);
  box-sizing: border-box;
  max-width: calc(100vw - var(--ptpp-toolbar-width, 96px) - 24px);
  min-width: min(360px, calc(100vw - var(--ptpp-toolbar-width, 96px) - 24px));
  overflow-y: auto;
  padding: 4px 0;
  position: absolute;
  top: 50%;
  transform: translateY(calc(-50% + var(--ptpp-menu-shift-y, 0px)));
  width: min(640px, calc(100vw - var(--ptpp-toolbar-width, 96px) - 24px));
  z-index: 2;
}

.ptpp-download-target-menu--dock-right {
  left: auto;
  right: calc(100% + 8px);
}

.ptpp-download-target-menu--dock-left {
  left: calc(100% + 8px);
  right: auto;
}

.ptpp-download-target-divider {
  border-top: 1px solid #b9d4e8;
  margin: 4px 0;
}

.ptpp-download-target-item {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 0;
  color: #194f77;
  cursor: pointer;
  display: grid;
  font:
    14px/1.35 Arial,
    "Microsoft YaHei",
    sans-serif;
  gap: 12px;
  grid-template-columns: 28px minmax(0, 1fr);
  min-height: 68px;
  padding: 8px 16px;
  text-align: left;
  width: 100%;

  &:hover,
  &:focus-visible {
    background: #dcecf7;
    outline: none;
  }
}

.ptpp-download-target-copy {
  display: grid;
  gap: 2px;
  min-width: 0;

  strong {
    color: #174f78;
    font-size: 16px;
  }
}

.ptpp-download-target-address,
.ptpp-download-target-path {
  overflow-wrap: anywhere;
}

.ptpp-download-target-address {
  color: #38769f;
}

.ptpp-download-target-path {
  color: #1f5d2f;
  font-weight: 600;
}
</style>
