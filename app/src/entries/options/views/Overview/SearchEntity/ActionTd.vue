<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage } from "@/messages.ts";
import type { ISearchResultTorrent } from "@/shared/types.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { resolveSiteDownloadTarget } from "@/shared/downloadTarget.ts";
import { sendTorrentAssignments } from "@/options/components/SentToDownloaderDialog/utils.ts";

import DownloadTargetMenu from "@/options/components/DownloadTargetMenu.vue";
import KeepUploadDialog from "./KeepUploadDialog.vue";

const {
  torrentItems,
  density = "default",
  showKeepUploadBtn = true,
} = defineProps<{
  torrentItems: ISearchResultTorrent[];
  density?: "compact" | "default";
  showKeepUploadBtn?: boolean;
}>();

const btnSize = computed(() => {
  return density === "compact" ? "small" : "default";
});

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const canDefaultSend = computed(
  () =>
    torrentItems.length > 0 &&
    torrentItems.every((torrent) => !resolveSiteDownloadTarget(metadataStore, torrent.site).requiresSelection),
);

async function getTorrentDownloadLinks() {
  const downloadUrls = [];

  for (const torrent of torrentItems) {
    const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);
    sendMessage("logger", {
      msg: `Resolved torrent download link for ${torrent.site ?? "unknown"}:${torrent.id ?? "unknown"}`,
    }).catch();
    downloadUrls.push({ torrent, downloadUrl });
  }

  return downloadUrls;
}

const copyTorrentDownloadLinkBtnStatus = ref(false);
async function copyTorrentDownloadLink() {
  copyTorrentDownloadLinkBtnStatus.value = true;
  const downloadUrls = await getTorrentDownloadLinks();
  try {
    await navigator.clipboard.writeText(
      downloadUrls
        .map((x) => x.downloadUrl)
        .join("\n")
        .trim(),
    );
    runtimeStore.showSnakebar(t("SearchEntity.ActionTd.copyLinkSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("SearchEntity.ActionTd.copyLinkFailed"), { color: "error" });
  }

  copyTorrentDownloadLinkBtnStatus.value = false;
}

const localDlTorrentDownloadLinkBtnStatus = ref(false);
async function localDlTorrentDownloadLink() {
  localDlTorrentDownloadLinkBtnStatus.value = true;
  await Promise.allSettled(
    torrentItems.map((torrent) => sendMessage("downloadTorrent", { torrent, downloaderId: "local" })),
  );
  localDlTorrentDownloadLinkBtnStatus.value = false;
}

const defaultSendLoading = ref(false);

async function sendToDefaultDownloader() {
  const resolvedItems = torrentItems.map((torrent) => ({
    torrent,
    target: resolveSiteDownloadTarget(metadataStore, torrent.site),
  }));
  const unresolved = resolvedItems.filter(({ target }) => target.requiresSelection);
  if (unresolved.length > 0) {
    runtimeStore.showSnakebar(t("SentToDownloaderDialog.defaultNeedsSelection", { count: unresolved.length }), {
      color: "warning",
    });
    return;
  }

  defaultSendLoading.value = true;
  try {
    await sendTorrentAssignments(
      resolvedItems.map(({ torrent, target }) => ({
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
  } finally {
    defaultSendLoading.value = false;
  }
}

const showKeepUploadDialog = ref(false);

function openKeepUploadDialog() {
  showKeepUploadDialog.value = true;
}
</script>

<template>
  <v-btn-group :density="density" class="table-action" color="grey" variant="text">
    <v-btn
      v-if="canDefaultSend"
      :disabled="torrentItems.length == 0"
      :loading="defaultSendLoading"
      :size="btnSize"
      icon="mdi-download"
      :title="t('SearchEntity.ActionTd.sendToDefault')"
      @click="sendToDefaultDownloader"
    />

    <!-- 下载到服务器 -->
    <DownloadTargetMenu :title="t('SearchEntity.ActionTd.sendToDownloader')" :torrent-items="torrentItems">
      <template #activator="{ disabled, loading, openMenu, status }">
        <v-btn
          :disabled="disabled"
          :loading="loading"
          :size="btnSize"
          :icon="status === 'success' ? 'mdi-check' : status === 'error' ? 'mdi-close' : 'mdi-cloud-download'"
          :title="t('SearchEntity.ActionTd.sendToDownloader')"
          @click="openMenu"
        />
      </template>
    </DownloadTargetMenu>
    <!-- 复制下载链接 -->
    <v-btn
      :disabled="torrentItems.length == 0"
      :loading="copyTorrentDownloadLinkBtnStatus"
      :size="btnSize"
      icon="mdi-content-copy"
      :title="t('SearchEntity.ActionTd.copyLink')"
      @click="() => copyTorrentDownloadLink()"
    />
    <!-- 下载种子文件到本地 -->
    <v-btn
      :disabled="torrentItems.length == 0"
      :loading="localDlTorrentDownloadLinkBtnStatus"
      :size="btnSize"
      icon="mdi-content-save"
      :title="t('SearchEntity.ActionTd.localDownload')"
      @click="() => localDlTorrentDownloadLink()"
    />
    <!-- 辅种检测 -->
    <v-btn
      v-if="showKeepUploadBtn"
      :disabled="torrentItems.length < 2"
      :size="btnSize"
      icon="mdi-merge"
      :title="t('SearchEntity.KeepUploadDialog.keepUpload')"
      @click="openKeepUploadDialog"
    />
  </v-btn-group>

  <!-- 辅种检测对话框 -->
  <KeepUploadDialog v-if="showKeepUploadBtn" v-model="showKeepUploadDialog" :torrent-items="torrentItems" />
</template>

<style scoped lang="scss"></style>
