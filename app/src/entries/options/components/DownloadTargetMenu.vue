<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from "vue";
import { useI18n } from "vue-i18n";
import type { ITorrent } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { buildSiteDownloadMenuTargets, type DownloadMenuTarget } from "@/shared/downloadTarget.ts";
import { sendTorrentToDownloader, type SendTorrentSummary } from "./SentToDownloaderDialog/utils.ts";

const props = withDefaults(
  defineProps<{
    torrentItems: ITorrent[];
    title: string;
    placement?: "bottom-end" | "top-end";
  }>(),
  { placement: "bottom-end" },
);

const emit = defineEmits<{
  (event: "done", summary: SendTorrentSummary): void;
}>();

const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const { t } = useI18n();

const anchor = ref<HTMLElement>();
const menu = ref<HTMLElement>();
const teleportTarget = ref<HTMLElement | ShadowRoot>();
const menuStyle = ref<CSSProperties>({});
const showMenu = ref(false);
const loading = ref(false);
const status = ref<"idle" | "success" | "error">("idle");

const siteId = computed(() => {
  const siteIds = [...new Set(props.torrentItems.map((torrent) => torrent.site).filter(Boolean))];
  return siteIds.length === 1 ? siteIds[0] : undefined;
});
const targets = computed(() => buildSiteDownloadMenuTargets(metadataStore, siteId.value));
const firstGeneralIndex = computed(() => targets.value.findIndex((target) => target.kind === "general"));
const disabled = computed(() => props.torrentItems.length === 0 || targets.value.length === 0);

function targetTitle(target: DownloadMenuTarget): string {
  return [
    target.downloader.name,
    target.downloader.address,
    target.savePath || t("contentScript.downloaderRootDirectory"),
    target.label ? `#${target.label}` : "",
  ]
    .filter(Boolean)
    .join(" → ");
}

async function openTargetMenu() {
  if (disabled.value) {
    runtimeStore.showSnakebar(t("contentScript.noAvailableDownloadTarget"), { color: "warning" });
    return;
  }
  if (showMenu.value) {
    closeMenu();
    return;
  }

  const root = anchor.value?.getRootNode();
  teleportTarget.value = root instanceof ShadowRoot ? root : document.body;
  updateMenuPosition();
  showMenu.value = true;
  await nextTick();
  menu.value?.querySelector<HTMLElement>(".ptpp-download-target-item")?.focus();
}

function updateMenuPosition() {
  const rect = anchor.value?.getBoundingClientRect();
  if (!rect) return;
  const right = Math.max(8, window.innerWidth - rect.right);
  menuStyle.value =
    props.placement === "top-end"
      ? { bottom: `${Math.max(8, window.innerHeight - rect.top + 5)}px`, right: `${right}px` }
      : { right: `${right}px`, top: `${Math.max(8, rect.bottom + 5)}px` };
}

function closeMenu() {
  showMenu.value = false;
}

function closeOnOutsidePointer(event: Event) {
  const path = event.composedPath();
  if (anchor.value && !path.includes(anchor.value) && (!menu.value || !path.includes(menu.value))) closeMenu();
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeMenu();
  anchor.value?.querySelector<HTMLElement>("button")?.focus();
}

watch(showMenu, (open) => {
  if (open) {
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeMenu, true);
    window.addEventListener("scroll", closeMenu, true);
  } else {
    document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    window.removeEventListener("keydown", closeOnEscape, true);
    window.removeEventListener("resize", closeMenu, true);
    window.removeEventListener("scroll", closeMenu, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  window.removeEventListener("keydown", closeOnEscape, true);
  window.removeEventListener("resize", closeMenu, true);
  window.removeEventListener("scroll", closeMenu, true);
});

async function selectTarget(target: DownloadMenuTarget) {
  closeMenu();
  loading.value = true;
  try {
    const summary = await sendTorrentToDownloader(props.torrentItems, target.downloaderId, {
      localDownload: true,
      addAtPaused: !target.autoStart,
      savePath: target.savePath,
      label: target.label,
      uploadSpeedLimit: 0,
      advanceAddTorrentOptions: target.downloader.advanceAddTorrentOptions ?? {},
    });
    status.value = summary.failedCount === 0 && summary.totalCount > 0 ? "success" : "error";
    emit("done", summary);
  } catch {
    status.value = "error";
  } finally {
    loading.value = false;
    window.setTimeout(() => (status.value = "idle"), 2000);
  }
}

defineExpose({ openTargetMenu, closeMenu });
</script>

<template>
  <div ref="anchor" class="ptpp-download-target-anchor">
    <slot name="activator" :disabled="disabled" :loading="loading" :open-menu="openTargetMenu" :status="status" />

    <Teleport v-if="teleportTarget" :to="teleportTarget">
      <div
        v-if="showMenu"
        ref="menu"
        class="ptpp-download-target-menu"
        :style="menuStyle"
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
            <v-icon :icon="target.kind === 'site' ? 'mdi-folder-star' : 'mdi-download-network'" size="22" />
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
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.ptpp-download-target-anchor {
  display: inline-flex;
  position: relative;
}

.ptpp-download-target-menu {
  background: #f3f8fc;
  border: 1px solid #b9d4e8;
  border-radius: 3px;
  box-shadow: 0 5px 15px rgb(0 0 0 / 28%);
  color: #194f77;
  display: flex;
  flex-direction: column;
  max-height: min(60vh, 520px);
  max-width: min(620px, calc(100vw - 32px));
  min-width: min(440px, calc(100vw - 32px));
  overflow-y: auto;
  padding: 4px 0;
  position: fixed;
  width: 560px;
  z-index: 3000;
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
    13px/1.35 Arial,
    "Microsoft YaHei",
    sans-serif;
  gap: 10px;
  grid-template-columns: 24px minmax(0, 1fr);
  min-height: 62px;
  padding: 7px 12px;
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
  gap: 1px;
  min-width: 0;

  strong {
    color: #174f78;
    font-size: 14px;
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
