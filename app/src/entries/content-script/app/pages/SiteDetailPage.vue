<script setup lang="ts">
import { computed, inject, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { resolveSiteDownloadTarget } from "@/shared/downloadTarget.ts";
import { formatSize } from "@/options/utils.ts";
import { sendTorrentAssignments } from "@/options/components/SentToDownloaderDialog/utils.ts";

import { copyTextToClipboard, doKeywordSearch, siteInstance, type IPtdData } from "../utils.ts";

import SpeedDialBtn from "../components/SpeedDialBtn.vue";
import DownloadTargetMenu from "../components/DownloadTargetMenu.vue";

const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const { t } = useI18n();

const ptdData = inject<IPtdData>("ptd_data", {});
const enabledDownloadersBySite = computed(() => {
  return metadataStore.getEnabledDownloadersBySite(ptdData.siteId ?? "");
});
const resolvedDefaultTarget = computed(() => resolveSiteDownloadTarget(metadataStore, ptdData.siteId));
const defaultSendLoading = ref(false);
const defaultSendStatus = ref<"idle" | "success" | "error">("idle");
const freeSpace = ref<string>("—");
const isCollected = ref(false);
const collectionLoading = ref(false);
const collectionStatus = ref<"idle" | "success" | "error">("idle");
const downloadTargetMenu = ref<InstanceType<typeof DownloadTargetMenu>>();

async function parseDetailPage() {
  const parsedResult = await siteInstance.value?.transformDetailPage(document);

  if (typeof parsedResult?.link === "undefined") {
    runtimeStore.showSnakebar(t("contentScript.cannotParseDetailLink"), { color: "error" });
    throw new Error("无法解析当前页面种子链接");
  }

  // 更新搜索状态，方便 SentToDownloaderDialog 中替换
  runtimeStore.search.searchPlanKey = "all";
  runtimeStore.search.searchKey = parsedResult?.title ?? "";

  return parsedResult!;
}

function handleLinkCopy() {
  parseDetailPage().then(async (torrent) => {
    const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);

    const copied = await copyTextToClipboard(downloadUrl);
    runtimeStore.showSnakebar(copied ? t("contentScript.copyLinkSuccess") : t("contentScript.copyLinkFailed"), {
      color: copied ? "success" : "error",
    });
  });
}

async function loadDetailTorrents() {
  return [await parseDetailPage()];
}

const defaultDownloadTitle = computed(() => {
  const target = resolvedDefaultTarget.value;
  if (target.requiresSelection || !target.downloader) return t("contentScript.oneClickDownloadNeedsSelection");
  return [t("contentScript.oneClickDownload"), target.downloader.name, target.savePath].filter(Boolean).join(" → ");
});

async function handleDefaultDownload() {
  const target = resolvedDefaultTarget.value;
  if (target.requiresSelection || !target.downloaderId || !target.downloader) {
    await downloadTargetMenu.value?.openTargetMenu();
    return;
  }

  defaultSendLoading.value = true;
  try {
    const torrent = await parseDetailPage();
    const summary = await sendTorrentAssignments([
      {
        torrent,
        downloaderId: target.downloaderId,
        addTorrentOptions: {
          localDownload: true,
          addAtPaused: !target.autoStart,
          savePath: target.savePath,
          label: target.label,
          uploadSpeedLimit: 0,
          advanceAddTorrentOptions: target.downloader.advanceAddTorrentOptions ?? {},
        },
      },
    ]);
    defaultSendStatus.value = summary.failedCount === 0 && summary.totalCount > 0 ? "success" : "error";
  } catch {
    defaultSendStatus.value = "error";
  } finally {
    defaultSendLoading.value = false;
    window.setTimeout(() => (defaultSendStatus.value = "idle"), 2000);
  }
}

async function refreshFreeSpace(downloaderId?: string) {
  freeSpace.value = "—";
  if (!downloaderId) return;
  try {
    const value = await sendMessage("getDownloaderFreeSpace", downloaderId);
    freeSpace.value = typeof value === "number" ? String(formatSize(value)) : value;
  } catch {
    freeSpace.value = "N/A";
  }
}

watch(
  () => resolvedDefaultTarget.value.downloaderId,
  (downloaderId) => refreshFreeSpace(downloaderId),
  { immediate: true },
);

async function refreshCollectionState() {
  try {
    isCollected.value = Boolean(await sendMessage("getPtppCollectionItem", location.href));
  } catch {
    isCollected.value = false;
  }
}

async function handleCollection() {
  collectionLoading.value = true;
  try {
    const torrent = await parseDetailPage();
    const result = await sendMessage("togglePtppCollection", {
      torrent,
      detailUrl: torrent.url || location.href,
    });
    isCollected.value = result.collected;
    collectionStatus.value = "success";
    runtimeStore.showSnakebar(
      t(result.collected ? "contentScript.collectionAdded" : "contentScript.collectionRemoved"),
      { color: "success" },
    );
  } catch (error) {
    collectionStatus.value = "error";
    runtimeStore.showSnakebar(`${t("contentScript.collectionFailed")}: ${String(error)}`, { color: "error" });
  } finally {
    collectionLoading.value = false;
    window.setTimeout(() => (collectionStatus.value = "idle"), 2000);
  }
}

function handleSearch() {
  parseDetailPage().then((torrent) => {
    doKeywordSearch(torrent.title || "");
  });
}

refreshCollectionState();
</script>

<template>
  <SpeedDialBtn
    key="download_default"
    :disabled="enabledDownloadersBySite.length === 0"
    icon="mdi-download"
    :label="t('contentScript.oneClickDownload')"
    :loading="defaultSendLoading"
    :status="defaultSendStatus"
    :title="defaultDownloadTitle"
    @click="handleDefaultDownload"
  />
  <DownloadTargetMenu
    ref="downloadTargetMenu"
    key="download"
    icon="mdi-download-box-outline"
    :load-torrents="loadDetailTorrents"
    :title="t('contentScript.downloadTo')"
  />
  <SpeedDialBtn
    key="copy"
    color="light-blue"
    icon="mdi-content-copy"
    :title="t('contentScript.copyLink')"
    @click="handleLinkCopy"
  />
  <SpeedDialBtn
    key="collection"
    :icon="isCollected ? 'mdi-heart' : 'mdi-heart-outline'"
    :label="isCollected ? t('contentScript.removeFromCollection') : t('contentScript.addToCollection')"
    :loading="collectionLoading"
    :status="collectionStatus"
    :title="isCollected ? t('contentScript.removeFromCollection') : t('contentScript.addToCollection')"
    @click="handleCollection"
  />
  <SpeedDialBtn
    key="search"
    color="indigo"
    icon="mdi-home-search"
    :title="t('contentScript.quickSearch')"
    @click="handleSearch"
  />
  <div class="ptpp-toolbar-free-space" :title="resolvedDefaultTarget.downloader?.name">
    <v-icon icon="mdi-cloud-outline" size="34" />
    <span>{{ freeSpace }}</span>
  </div>
</template>

<style scoped lang="scss">
.ptpp-toolbar-free-space {
  align-items: center;
  border-top: 1px dotted #c8d3dc;
  color: #1976d2;
  display: flex;
  flex-direction: column;
  font:
    12px/1.25 Arial,
    "Microsoft YaHei",
    sans-serif;
  justify-content: center;
  min-height: 58px;
  padding: 6px 3px;
  text-align: center;
}
</style>
