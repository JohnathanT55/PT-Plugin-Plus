<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { inheritCollectionSearchMovieIds } from "@foundation/collection/searchContext";

import { sendMessage } from "@/messages.ts";
import type { ITorrent } from "@ptd/site";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { notifyCollectionChanged, useCollectionRevision } from "@/options/composables/collectionState.ts";
import { resolveSiteDownloadTarget } from "@/shared/downloadTarget.ts";
import { sendTorrentAssignments } from "@/options/components/SentToDownloaderDialog/utils.ts";
import { formatSize } from "@/options/utils.ts";

import DownloadTargetMenu from "@/options/components/DownloadTargetMenu.vue";
import CollectionGroupMenu from "./CollectionGroupMenu.vue";
import KeepUploadDialog from "./KeepUploadDialog.vue";

const {
  torrentItems,
  density = "default",
  showKeepUploadBtn = true,
  showFavoriteBtn = false,
  showDefaultSendBtn = true,
  showManualSendBtn = true,
  showCopyBtn = true,
  showLocalDownloadBtn = true,
  showLabels = false,
} = defineProps<{
  torrentItems: ITorrent[];
  density?: "compact" | "default";
  showKeepUploadBtn?: boolean;
  showFavoriteBtn?: boolean;
  showDefaultSendBtn?: boolean;
  showManualSendBtn?: boolean;
  showCopyBtn?: boolean;
  showLocalDownloadBtn?: boolean;
  showLabels?: boolean;
}>();

const btnSize = computed(() => (density === "compact" ? "small" : "default"));
const selectedSize = computed(() => torrentItems.reduce((total, torrent) => total + (torrent.size ?? 0), 0));

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const collectionRevision = useCollectionRevision();
const collectionTorrentItems = computed(() =>
  torrentItems.map((torrent) => inheritCollectionSearchMovieIds(torrent, runtimeStore.search.searchKey)),
);
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
  try {
    const downloadUrls = await getTorrentDownloadLinks();
    await navigator.clipboard.writeText(
      downloadUrls
        .map((x) => x.downloadUrl)
        .join("\n")
        .trim(),
    );
    runtimeStore.showSnakebar(t("SearchEntity.ActionTd.copyLinkSuccess"), { color: "success" });
  } catch (error) {
    runtimeStore.showSnakebar(`${t("SearchEntity.ActionTd.copyLinkFailed")}: ${String(error)}`, { color: "error" });
  } finally {
    copyTorrentDownloadLinkBtnStatus.value = false;
  }
}

const localDlTorrentDownloadLinkBtnStatus = ref(false);
async function localDlTorrentDownloadLink() {
  localDlTorrentDownloadLinkBtnStatus.value = true;
  try {
    await Promise.allSettled(
      torrentItems.map((torrent) => sendMessage("downloadTorrent", { torrent, downloaderId: "local" })),
    );
  } finally {
    localDlTorrentDownloadLinkBtnStatus.value = false;
  }
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

const favoriteLoading = ref(false);
const singleFavoriteState = ref<boolean | null>(null);
let favoriteStateRequest = 0;

watch(
  () => [collectionTorrentItems.value.length, collectionTorrentItems.value[0]?.url, collectionRevision.value] as const,
  async () => {
    const request = ++favoriteStateRequest;
    singleFavoriteState.value = null;
    if (!showFavoriteBtn || collectionTorrentItems.value.length !== 1 || !collectionTorrentItems.value[0]?.url) return;
    try {
      const collected = Boolean(await sendMessage("getPtppCollectionItem", collectionTorrentItems.value[0].url));
      if (request === favoriteStateRequest) singleFavoriteState.value = collected;
    } catch {
      if (request === favoriteStateRequest) singleFavoriteState.value = null;
    }
  },
  { immediate: true },
);

async function addSelectedToCollection(groupId?: string) {
  favoriteLoading.value = true;
  let addedCount = 0;

  try {
    if (collectionTorrentItems.value.length === 1 && collectionTorrentItems.value[0]?.url && !groupId) {
      const result = await sendMessage("togglePtppCollection", {
        torrent: collectionTorrentItems.value[0],
        detailUrl: collectionTorrentItems.value[0].url,
      });
      singleFavoriteState.value = result.collected;
      notifyCollectionChanged();
      runtimeStore.showSnakebar(
        t(result.collected ? "SearchEntity.ActionTd.collectionAdded" : "SearchEntity.ActionTd.collectionRemoved", {
          count: 1,
        }),
        { color: "success" },
      );
      return;
    }

    for (const torrent of collectionTorrentItems.value) {
      if (!torrent.url) continue;
      const existing = await sendMessage("getPtppCollectionItem", torrent.url);
      if (existing) continue;

      const result = await sendMessage("togglePtppCollection", { torrent, detailUrl: torrent.url, groupId });
      if (result.collected) addedCount += 1;
    }

    if (addedCount > 0) notifyCollectionChanged();

    runtimeStore.showSnakebar(
      addedCount > 0
        ? t("SearchEntity.ActionTd.collectionAdded", { count: addedCount })
        : t("SearchEntity.ActionTd.collectionAlreadyAdded"),
      { color: "success" },
    );
  } catch (error) {
    runtimeStore.showSnakebar(`${t("SearchEntity.ActionTd.collectionFailed")}: ${String(error)}`, { color: "error" });
  } finally {
    favoriteLoading.value = false;
  }
}

const showKeepUploadDialog = ref(false);

function openKeepUploadDialog() {
  showKeepUploadDialog.value = true;
}
</script>

<template>
  <v-btn-group
    :density="density"
    :class="['table-action', { 'ptpp-batch-actions': showLabels }]"
    :color="showLabels ? 'success' : 'grey'"
    :variant="showLabels ? 'elevated' : 'text'"
  >
    <v-btn
      v-if="showDefaultSendBtn && canDefaultSend"
      :disabled="torrentItems.length === 0"
      :loading="defaultSendLoading"
      :size="btnSize"
      :icon="!showLabels"
      :title="t('SearchEntity.ActionTd.sendToDefault')"
      @click="sendToDefaultDownloader"
    >
      <v-icon icon="mdi-download" />
      <span v-if="showLabels" class="ptpp-action-label">
        {{ t("SearchEntity.ActionTd.push") }} ({{ torrentItems.length }}) {{ formatSize(selectedSize) }}
      </span>
    </v-btn>

    <DownloadTargetMenu
      v-if="showManualSendBtn"
      :title="t('SearchEntity.ActionTd.sendToDownloader')"
      :torrent-items="torrentItems"
    >
      <template #activator="{ disabled, loading, openMenu, status }">
        <v-btn
          :disabled="disabled"
          :loading="loading"
          :size="btnSize"
          :icon="!showLabels"
          :title="t('SearchEntity.ActionTd.sendToDownloader')"
          @click="openMenu"
        >
          <v-icon
            :icon="status === 'success' ? 'mdi-check' : status === 'error' ? 'mdi-close' : 'mdi-cloud-download'"
          />
          <span v-if="showLabels" class="ptpp-action-label">{{ t("SearchEntity.ActionTd.pushTo") }}</span>
        </v-btn>
      </template>
    </DownloadTargetMenu>

    <v-btn
      v-if="showCopyBtn"
      :disabled="torrentItems.length === 0"
      :loading="copyTorrentDownloadLinkBtnStatus"
      :size="btnSize"
      :icon="!showLabels"
      :title="t('SearchEntity.ActionTd.copyLink')"
      @click="copyTorrentDownloadLink"
    >
      <v-icon icon="mdi-content-copy" />
      <span v-if="showLabels" class="ptpp-action-label">{{ t("SearchEntity.ActionTd.copy") }}</span>
    </v-btn>

    <v-btn
      v-if="showLocalDownloadBtn"
      :disabled="torrentItems.length === 0"
      :loading="localDlTorrentDownloadLinkBtnStatus"
      :size="btnSize"
      :icon="!showLabels"
      :title="t('SearchEntity.ActionTd.localDownload')"
      @click="localDlTorrentDownloadLink"
    >
      <v-icon icon="mdi-content-save" />
      <span v-if="showLabels" class="ptpp-action-label">{{ t("SearchEntity.ActionTd.save") }}</span>
    </v-btn>

    <CollectionGroupMenu
      v-if="showFavoriteBtn && torrentItems.length > 1"
      :disabled="torrentItems.length === 0"
      :title="t('SearchEntity.ActionTd.favorite')"
      @select="addSelectedToCollection"
    >
      <template #activator="{ disabled, loading, openMenu }">
        <v-btn
          :disabled="disabled"
          :loading="loading || favoriteLoading"
          :size="btnSize"
          :icon="!showLabels"
          :title="t('SearchEntity.ActionTd.favorite')"
          @click="openMenu"
        >
          <v-icon icon="mdi-heart-outline" />
          <span v-if="showLabels" class="ptpp-action-label">
            {{ t("SearchEntity.ActionTd.favorite") }}
          </span>
        </v-btn>
      </template>
    </CollectionGroupMenu>

    <v-btn
      v-else-if="showFavoriteBtn"
      :color="singleFavoriteState ? 'pink' : undefined"
      :disabled="torrentItems.length === 0"
      :loading="favoriteLoading"
      :size="btnSize"
      :icon="!showLabels"
      :title="t(singleFavoriteState ? 'SearchEntity.ActionTd.unfavorite' : 'SearchEntity.ActionTd.favorite')"
      @click="addSelectedToCollection()"
    >
      <v-icon :icon="singleFavoriteState ? 'mdi-heart' : 'mdi-heart-outline'" />
      <span v-if="showLabels" class="ptpp-action-label">
        {{ t(singleFavoriteState ? "SearchEntity.ActionTd.unfavorite" : "SearchEntity.ActionTd.favorite") }}
      </span>
    </v-btn>

    <v-btn
      v-if="showKeepUploadBtn"
      :disabled="torrentItems.length < 2"
      :size="btnSize"
      :icon="!showLabels"
      :title="t('SearchEntity.KeepUploadDialog.keepUpload')"
      @click="openKeepUploadDialog"
    >
      <v-icon icon="mdi-merge" />
      <span v-if="showLabels" class="ptpp-action-label">{{ t("SearchEntity.KeepUploadDialog.keepUpload") }}</span>
    </v-btn>
  </v-btn-group>

  <KeepUploadDialog v-if="showKeepUploadBtn" v-model="showKeepUploadDialog" :torrent-items="torrentItems" />
</template>

<style scoped lang="scss">
.ptpp-batch-actions {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: nowrap;
  gap: 4px;
  height: 32px;

  :deep(.v-btn) {
    border-radius: 2px !important;
    box-shadow:
      0 2px 2px rgba(0, 0, 0, 0.16),
      0 1px 5px rgba(0, 0, 0, 0.12);
    color: #fff !important;
    flex: 0 0 auto;
    height: 32px !important;
    min-width: auto;
    padding-inline: 10px;
  }

  :deep(.v-btn--disabled) {
    box-shadow: none;
  }
}

.ptpp-action-label {
  margin-left: 6px;
  white-space: nowrap;
}
</style>
