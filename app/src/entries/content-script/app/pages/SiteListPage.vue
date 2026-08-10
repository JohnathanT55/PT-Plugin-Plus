<script setup lang="ts">
import { computed, inject, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { type ITorrent } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { resolveSiteDownloadTarget } from "@/shared/downloadTarget.ts";
import { sendTorrentAssignments } from "@/options/components/SentToDownloaderDialog/utils.ts";

import { copyTextToClipboard, doKeywordSearch, siteInstance, wrapperConfirmFn, type IPtdData } from "../utils.ts";

import AdvanceListModuleDialog from "../components/AdvanceListModuleDialog.vue";
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

async function parseListPage(showNoTorrentError = true) {
  // 使用克隆的文档，避免污染原始文档
  const parsedResult = await siteInstance.value?.transformListPage(document.cloneNode(true) as Document);

  let errorMessage = "";
  if ((parsedResult?.torrents ?? []).length === 0) {
    errorMessage = t("contentScript.noTorrentParsed");
  }

  if (showNoTorrentError && errorMessage) {
    runtimeStore.showSnakebar(errorMessage, { color: "error" });
  }

  // 更新搜索状态，方便 SentToDownloaderDialog 中替换
  runtimeStore.search.searchPlanKey = "all";
  runtimeStore.search.searchKey = parsedResult?.keywords ?? "";

  return parsedResult!;
}

const localDownloadMultiStatus = ref<boolean>(false);
function handleLocalDownloadMulti() {
  localDownloadMultiStatus.value = true;
  parseListPage()
    .then(({ torrents }) => {
      for (const torrent of torrents) {
        sendMessage("downloadTorrent", { torrent, downloaderId: "local" });
      }
    })
    .finally(() => {
      localDownloadMultiStatus.value = false;
    });
}

const linkCopyMultiStatus = ref<boolean>(false);
function handleLinkCopyMulti() {
  linkCopyMultiStatus.value = true;
  parseListPage()
    .then(async ({ torrents }) => {
      const downloadUrls = [] as string[];

      try {
        for (const torrent of torrents) {
          const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);
          downloadUrls.push(downloadUrl);
        }

        const copied = await copyTextToClipboard(downloadUrls.join("\n").trim());
        runtimeStore.showSnakebar(copied ? t("contentScript.copyLinkSuccess") : t("contentScript.copyLinkFailed"), {
          color: copied ? "success" : "error",
        });
      } catch (e) {
        runtimeStore.showSnakebar(t("contentScript.copyLinkFailed"), { color: "error" });
      }
    })
    .finally(() => {
      linkCopyMultiStatus.value = false;
    });
}

async function loadListTorrents() {
  return (await parseListPage()).torrents;
}

const defaultSendLoading = ref(false);
const defaultSendStatus = ref<"idle" | "success" | "error">("idle");
const downloadTargetMenu = ref<InstanceType<typeof DownloadTargetMenu>>();
const defaultDownloadTitle = computed(() => {
  const target = resolvedDefaultTarget.value;
  if (target.requiresSelection || !target.downloader) return t("contentScript.oneClickDownloadNeedsSelection");
  return [t("contentScript.oneClickDownloadAll"), target.downloader.name, target.savePath].filter(Boolean).join(" → ");
});

async function handleDefaultDownloadMulti() {
  const target = resolvedDefaultTarget.value;
  if (target.requiresSelection || !target.downloaderId || !target.downloader) {
    await downloadTargetMenu.value?.openTargetMenu();
    return;
  }

  defaultSendLoading.value = true;
  try {
    const torrents = await loadListTorrents();
    const summary = await sendTorrentAssignments(
      torrents.map((torrent) => ({
        torrent,
        downloaderId: target.downloaderId!,
        addTorrentOptions: {
          localDownload: true,
          addAtPaused: !target.autoStart,
          savePath: target.savePath,
          label: target.label,
          uploadSpeedLimit: 0,
          advanceAddTorrentOptions: target.downloader?.advanceAddTorrentOptions ?? {},
        },
      })),
    );
    defaultSendStatus.value = summary.failedCount === 0 && summary.totalCount > 0 ? "success" : "error";
  } catch {
    defaultSendStatus.value = "error";
  } finally {
    defaultSendLoading.value = false;
    window.setTimeout(() => (defaultSendStatus.value = "idle"), 2000);
  }
}

const parsedTorrents = shallowRef<ITorrent[]>([]);
const showAdvanceListModuleDialog = ref<boolean>(false);

function handleAdvanceListModule() {
  parseListPage().then(({ torrents }) => {
    if (torrents.length > 0) {
      parsedTorrents.value = torrents;
      showAdvanceListModuleDialog.value = true;
    }
  });
}

async function handleSearch() {
  let keywords = (await parseListPage()).keywords;

  doKeywordSearch(keywords);
}
</script>

<template>
  <SpeedDialBtn
    key="download_default"
    :disabled="enabledDownloadersBySite.length === 0"
    icon="mdi-download-multiple"
    :label="t('contentScript.oneClickDownloadAll')"
    :loading="defaultSendLoading"
    :status="defaultSendStatus"
    :title="defaultDownloadTitle"
    @click="() => wrapperConfirmFn(handleDefaultDownloadMulti)"
  />
  <DownloadTargetMenu
    ref="downloadTargetMenu"
    key="download"
    icon="mdi-download-box-outline"
    :load-torrents="loadListTorrents"
    :title="t('contentScript.downloadTo')"
  />
  <SpeedDialBtn
    key="save"
    :loading="localDownloadMultiStatus"
    color="light-blue"
    icon="mdi-content-save-all"
    :title="t('downloaderLabel.localDownload')"
    @click="wrapperConfirmFn(handleLocalDownloadMulti)"
  />
  <SpeedDialBtn
    key="copy"
    :loading="linkCopyMultiStatus"
    color="light-blue"
    icon="mdi-content-copy"
    :title="t('contentScript.copyLink')"
    @click="wrapperConfirmFn(handleLinkCopyMulti)"
  />
  <SpeedDialBtn
    key="advance"
    color="indigo"
    icon="mdi-checkbox-multiple-marked"
    :title="t('contentScript.advanceList')"
    @click="handleAdvanceListModule"
  />
  <SpeedDialBtn
    key="search"
    color="indigo"
    icon="mdi-home-search"
    :title="t('contentScript.quickSearch')"
    @click="handleSearch"
  />

  <AdvanceListModuleDialog v-model="showAdvanceListModuleDialog" :torrent-items="parsedTorrents" />
</template>

<style scoped lang="scss"></style>
