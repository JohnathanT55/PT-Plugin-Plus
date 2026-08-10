<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useWindowSize } from "@vueuse/core";
import { ETorrentStatus, ITorrent } from "@ptd/site";
import type { DataTableHeader } from "vuetify";

import { formatDate, formatSize } from "@/options/utils.ts";
import { sendMessage } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { resolveSiteDownloadTarget } from "@/shared/downloadTarget.ts";
import { sendTorrentAssignments } from "@/options/components/SentToDownloaderDialog/utils.ts";

import NavButton from "@/options/components/NavButton.vue";
import DownloadTargetMenu from "@/options/components/DownloadTargetMenu.vue";
import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";

const { t } = useI18n();

const showDialog = defineModel<boolean>();

const { height: windowHeight } = useWindowSize();

const { torrentItems } = defineProps<{
  torrentItems: ITorrent[];
}>();

const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const tableHeaders = computed(
  () =>
    [
      { title: t("SearchEntity.index.table.category"), key: "category", align: "center", maxWidth: 60 },
      { title: t("SearchEntity.index.table.title"), key: "title", align: "start", maxWidth: 400 },
      { title: t("SearchEntity.index.table.size"), key: "size", align: "end", minWidth: 60 },
      { title: t("SearchEntity.index.table.seeders"), key: "seeders", align: "end", minWidth: 40 },
      { title: t("SearchEntity.index.table.leechers"), key: "leechers", align: "end", minWidth: 40 },
      { title: t("SearchEntity.index.table.completed"), key: "completed", align: "end", minWidth: 40 },
      { title: t("SearchEntity.index.table.time"), key: "time", align: "center", minWidth: 80 },
    ] as DataTableHeader[],
);

const selectedTorrentIds = ref<ITorrent["id"][]>([]);
const selectedTorrents = computed(() => torrentItems.filter((x) => selectedTorrentIds.value.includes(x.id)));
const canDefaultSend = computed(
  () =>
    selectedTorrents.value.length > 0 &&
    selectedTorrents.value.every(
      (torrent) => !resolveSiteDownloadTarget(metadataStore, torrent.site).requiresSelection,
    ),
);
const hasSelectedTorrent = computed(() => selectedTorrentIds.value.length > 0);
const selectedTorrentsCount = computed(() => selectedTorrentIds.value.length);
const selectedTorrentsSize = computed(() =>
  selectedTorrents.value.reduce((acc, torrent) => acc + (torrent.size ?? 0), 0),
);

const localDownloadMultiStatus = ref<boolean>(false);
async function handleLocalDownloadMulti() {
  localDownloadMultiStatus.value = true;
  for (const torrent of selectedTorrents.value) {
    await sendMessage("downloadTorrent", { torrent, downloaderId: "local" });
  }
  localDownloadMultiStatus.value = false;
}

const linkCopyMultiStatus = ref<boolean>(false);
async function handleLinkCopyMulti() {
  linkCopyMultiStatus.value = true;
  const downloadUrls = [] as string[];

  try {
    for (const torrent of selectedTorrents.value) {
      const downloadUrl = await sendMessage("getTorrentDownloadLink", torrent);
      downloadUrls.push(downloadUrl);
    }

    await navigator.clipboard.writeText(downloadUrls.join("\n").trim());
    runtimeStore.showSnakebar(t("contentScript.copyLinkSuccess"), { color: "success" });
  } catch (e) {
    runtimeStore.showSnakebar(t("contentScript.copyLinkFailed"), { color: "error" });
  } finally {
    linkCopyMultiStatus.value = false;
  }
}

const remoteDownloadMultiStatus = ref(false);

async function handleDefaultRemoteDownloadMulti() {
  const resolvedItems = selectedTorrents.value.map((torrent) => ({
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

  remoteDownloadMultiStatus.value = true;
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
    remoteDownloadMultiStatus.value = false;
  }
}

function handleSelectSeeders() {
  selectedTorrentIds.value = torrentItems.filter((item) => item.seeders).map((x) => x.id);
}

function handleSelectNotSeeding() {
  selectedTorrentIds.value = torrentItems
    .filter(
      (item) =>
        item.status !== undefined && ![ETorrentStatus.seeding, ETorrentStatus.downloading].includes(item.status!),
    )
    .map((x) => x.id);
}

function enterDialog() {
  selectedTorrentIds.value = torrentItems.map((x) => x.id);
}
</script>

<template>
  <v-dialog v-model="showDialog" max-width="1200" scrollable @after-enter="enterDialog">
    <v-card>
      <v-card-title class="pa-0">
        <v-toolbar color="blue-grey-darken-2">
          <v-toolbar-title>{{
            t("contentScript.AdvanceListModuleDialog.title", [torrentItems.length])
          }}</v-toolbar-title>
          <template #append>
            <v-btn icon="mdi-close" :title="t('common.dialog.close')" @click="showDialog = false" />
          </template>
        </v-toolbar>
      </v-card-title>
      <v-card-text class="overflow-y-hidden">
        <NavButton
          icon="mdi-inbox-arrow-up"
          :text="t('contentScript.AdvanceListModuleDialog.selectSeeders')"
          color="light-blue"
          @click="handleSelectSeeders"
        />
        <NavButton
          icon="mdi-download-off"
          :text="t('contentScript.AdvanceListModuleDialog.selectNotSeeding')"
          color="light-blue"
          @click="handleSelectNotSeeding"
        />
        <v-data-table-virtual
          v-model="selectedTorrentIds"
          :headers="tableHeaders"
          :height="windowHeight - 256"
          :items="torrentItems"
          class="search-entity-table table-stripe table-header-no-wrap table-no-ext-padding"
          fixed-header
          hover
          item-value="id"
          show-select
        >
          <template #item.title="{ item }">
            <TorrentTitleTd :item="item" :show-social="false" />
          </template>

          <!-- 种子大小 -->
          <template #item.size="{ item }">
            <span class="t_size text-no-wrap">{{ formatSize(item.size ?? 0) }}</span>
          </template>

          <template #item.time="{ item }">
            <span class="t_time text-no-wrap">
              {{ item.time ? formatDate(item.time) : "-" }}
            </span>
          </template>
        </v-data-table-virtual>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-spacer />
        <span v-show="hasSelectedTorrent">{{
          t("contentScript.AdvanceListModuleDialog.selectedInfo", [
            selectedTorrentsCount,
            formatSize(selectedTorrentsSize),
          ])
        }}</span>

        <NavButton
          :disabled="!hasSelectedTorrent"
          :loading="localDownloadMultiStatus"
          color="light-blue"
          icon="mdi-content-save-all"
          :text="t('downloaderLabel.localDownload')"
          @click="handleLocalDownloadMulti"
        />

        <NavButton
          :disabled="!hasSelectedTorrent"
          :loading="linkCopyMultiStatus"
          color="light-blue"
          icon="mdi-content-copy"
          :text="t('contentScript.copyLink')"
          @click="handleLinkCopyMulti"
        />

        <DownloadTargetMenu placement="top-end" :title="t('contentScript.pushTo')" :torrent-items="selectedTorrents">
          <template #activator="{ disabled, loading, openMenu, status }">
            <NavButton
              :disabled="disabled"
              key="remote_download_multi"
              :loading="loading"
              color="light-blue"
              :icon="status === 'success' ? 'mdi-check' : status === 'error' ? 'mdi-close' : 'mdi-cloud-download'"
              :text="t('contentScript.pushTo')"
              @click="openMenu"
            />
          </template>
        </DownloadTargetMenu>

        <NavButton
          v-if="canDefaultSend"
          key="remote_download_multi_default"
          :disabled="!hasSelectedTorrent"
          :loading="remoteDownloadMultiStatus"
          color="light-blue"
          icon="mdi-download"
          :text="t('contentScript.pushToDefault')"
          @click="handleDefaultRemoteDownloadMulti"
        />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss"></style>
