<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import type { CAddTorrentOptions } from "@ptd/downloader";

import { sendMessage } from "@/messages.ts";
import { useResetableRef } from "@/options/directives/useResetableRef.ts";
import type { ITorrentDownloadMetadata } from "@/shared/types.ts";

import DownloadTargetMenu from "@/options/components/DownloadTargetMenu.vue";

const { t } = useI18n();

const showDialog = defineModel<boolean>();
const emit = defineEmits<{
  (e: "reDownloadComplete"): void;
}>();

const { torrentItems } = defineProps<{
  torrentItems: ITorrentDownloadMetadata[];
}>();

type TReDownloadType = "old" | "local" | "downloader";

const { ref: isReDownloading, reset: resetIsReDownloading } = useResetableRef<Record<TReDownloadType, boolean>>(() => ({
  old: false,
  local: false,
  downloader: false,
}));

const disableLocalDownload = ref<boolean>(false);
const downloadTorrents = computed(() => torrentItems.map((item) => item.torrent));

const btnItem: Record<TReDownloadType, { icon: string; color: string; title: string }> = {
  old: { icon: "mdi-reload", color: "indigo", title: t("DownloadHistory.ReDownloadSelectDialog.oldMethod") },
  local: { icon: "mdi-content-save", color: "orange", title: t("downloaderLabel.localDownload") },
  downloader: {
    icon: "mdi-cloud-download",
    color: "cyan",
    title: t("DownloadHistory.ReDownloadSelectDialog.selectDownloader"),
  },
};

function submitDownloadFinish(reDownloadType: TReDownloadType) {
  isReDownloading.value[reDownloadType] = false;
  emit("reDownloadComplete");
  showDialog.value = false;
}

function reDownload(reDownloadType: TReDownloadType) {
  isReDownloading.value[reDownloadType] = true;
  // 对 old 和 local 直接调用下载方法；downloader 使用下方 PTPP 锚定菜单。
  const promises = [];

  for (const history of torrentItems) {
    if (history) {
      const historyTorrent = history.torrent;
      if (reDownloadType === "local" || history.downloaderId === "local") {
        promises.push(sendMessage("downloadTorrent", { torrent: historyTorrent, downloaderId: "local" }));
      } else {
        promises.push(
          sendMessage("downloadTorrent", {
            torrent: historyTorrent,
            downloaderId: history.downloaderId,
            addTorrentOptions: (history.addTorrentOptions ?? {}) as CAddTorrentOptions,
          }),
        );
      }
    }
  }

  Promise.all(promises).finally(() => {
    submitDownloadFinish(reDownloadType);
  });
}

function dialogEnter() {
  resetIsReDownloading();

  // 如果传入的种子列表中有 magnet 链接，则禁用本地下载按钮
  disableLocalDownload.value = torrentItems.some((t) => t?.torrent?.link?.startsWith("magnet:"));
}
</script>

<template>
  <v-dialog v-model="showDialog" max-width="600" @after-enter="dialogEnter">
    <v-card>
      <v-card-title class="pa-0">
        <v-toolbar color="primary">
          <v-toolbar-title>{{
            t("DownloadHistory.ReDownloadSelectDialog.title", [torrentItems.length])
          }}</v-toolbar-title>
          <template #append>
            <v-btn icon="mdi-close" :title="t('common.dialog.close')" @click="showDialog = false" />
          </template>
        </v-toolbar>
      </v-card-title>
      <v-card-text class="pa-1">
        <v-list>
          <v-list-item v-for="(value, key) in btnItem" :key="key">
            <DownloadTargetMenu
              v-if="key === 'downloader'"
              class="w-100"
              :title="value.title"
              :torrent-items="downloadTorrents"
              @done="() => submitDownloadFinish('downloader')"
            >
              <template #activator="{ disabled, loading, openMenu, status }">
                <v-btn
                  :disabled="disabled"
                  :loading="loading"
                  block
                  class="justify-start"
                  :color="value.color"
                  :prepend-icon="status === 'success' ? 'mdi-check' : status === 'error' ? 'mdi-close' : value.icon"
                  size="x-large"
                  variant="tonal"
                  @click="openMenu"
                >
                  {{ value.title }}
                </v-btn>
              </template>
            </DownloadTargetMenu>
            <v-btn
              v-else
              :loading="isReDownloading[key]"
              block
              class="justify-start"
              :color="value.color"
              :prepend-icon="value.icon"
              size="x-large"
              variant="tonal"
              @click="reDownload(key)"
            >
              {{ value.title }}
            </v-btn>
          </v-list-item>
        </v-list>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss"></style>
