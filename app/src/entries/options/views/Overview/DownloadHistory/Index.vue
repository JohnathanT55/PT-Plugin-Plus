<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { onMounted, onUnmounted, ref, shallowRef, computed } from "vue";
import { useDisplay, type DataTableHeader } from "vuetify";

import { sendMessage } from "@/messages.ts";
import { formatDate } from "@/options/utils.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import type { ITorrentDownloadMetadata, TTorrentDownloadKey } from "@/shared/types.ts";

import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";
import DeleteDialog from "@/options/components/DeleteDialog.vue";
import DownloaderLabel from "@/options/components/DownloaderLabel.vue";
import NavButton from "@/options/components/NavButton.vue";
import ResponsiveDataTable from "@/options/components/ResponsiveDataTable.vue";
import ReDownloadSelectDialog from "./ReDownloadSelectDialog.vue";
import AdvanceFilterGenerateDialog from "./AdvanceFilterGenerateDialog.vue";

import {
  downloadHistory,
  downloadHistoryList,
  downloadStatusMap,
  tableCustomFilter,
  clearWatchingMap,
  throttleLoadDownloadHistory,
} from "./utils.ts"; // <-- 主要方法

const { t } = useI18n();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const display = useDisplay();

const { tableFilterRef, tableWaitFilterRef, tableFilterFn } = tableCustomFilter;

const tableHeader = computed(
  () =>
    [
      { title: t("common.site"), key: "siteId", align: "center" },
      {
        title: t("DownloadHistory.table.title"),
        key: "title",
        align: "start",
        minWidth: "clamp(18rem, 30vw, 26rem)",
        ...(display.smAndDown.value ? { maxWidth: "32vw" } : {}),
      },
      { title: t("DownloadHistory.table.downloader"), key: "downloaderId", width: "11%", align: "start" },
      { title: t("DownloadHistory.table.downloadAt"), key: "downloadAt", align: "center" },
      { title: t("DownloadHistory.table.status"), key: "downloadStatus" },
      { title: t("common.action"), key: "action", align: "center", sortable: false },
    ] as DataTableHeader[],
);
const tableSelected = ref<TTorrentDownloadKey[]>([]);

const showAdvanceFilterDialog = ref<boolean>(false);

const showReDownloadSelectDialog = ref<boolean>(false);
const reDownloadTorrentListRef = shallowRef<ITorrentDownloadMetadata[]>([]);

function reDownloadTorrent(downloadHistoryIds: TTorrentDownloadKey[]) {
  const reDownloadTorrentList = [];
  for (const downloadHistoryId of downloadHistoryIds) {
    const history: ITorrentDownloadMetadata = downloadHistory.value[downloadHistoryId];
    if (history) {
      reDownloadTorrentList.push(history);
    }
  }
  reDownloadTorrentListRef.value = reDownloadTorrentList;
  showReDownloadSelectDialog.value = true;
}

const showDeleteDialog = ref<boolean>(false);
const toDeleteIds = ref<TTorrentDownloadKey[]>([]);
const isClearingAll = ref(false);

async function deleteDownloadHistory(downloadHistoryIds: TTorrentDownloadKey[]) {
  toDeleteIds.value = downloadHistoryIds;
  showDeleteDialog.value = true;
}

async function confirmDeleteDownloadHistory(downloadHistoryId: TTorrentDownloadKey) {
  return await sendMessage("deleteDownloadHistoryById", downloadHistoryId);
}

function handleDownloadHistoryDeleted() {
  const deletedIds = new Set(toDeleteIds.value);
  tableSelected.value = tableSelected.value.filter((id) => !deletedIds.has(id));
  toDeleteIds.value = [];
  throttleLoadDownloadHistory();
}

async function clearAllDownloadHistory() {
  const count = downloadHistoryList.value.length;
  if (!count || !confirm(t("DownloadHistory.clearConfirm", { count }))) return;

  isClearingAll.value = true;
  try {
    clearWatchingMap();
    await sendMessage("clearDownloadHistory", undefined);
    downloadHistory.value = {};
    tableSelected.value = [];
    tableCustomFilter.buildAdvanceItemPropsFn();
    runtimeStore.showSnakebar(t("DownloadHistory.clearSuccess"), { color: "success" });
  } catch (error) {
    runtimeStore.showSnakebar(t("DownloadHistory.clearError"), { color: "error" });
    throttleLoadDownloadHistory();
  } finally {
    isClearingAll.value = false;
  }
}

const showDownloadDetailDialog = ref<boolean>(false);
const downloadDetail = ref<ITorrentDownloadMetadata | null>(null);

const safeDownloadDetail = computed(() => {
  const history = downloadDetail.value;
  if (!history) return {};

  return {
    siteId: history.siteId,
    torrentId: history.torrentId,
    title: history.title || history.torrent?.title || "",
    downloaderId: history.downloaderId,
    downloadAt: formatDate(history.downloadAt ?? 0),
    downloadStatus: history.downloadStatus,
    savePath: history.addTorrentOptions?.savePath || "",
    label: history.addTorrentOptions?.label || "",
    addAtPaused: history.addTorrentOptions?.addAtPaused ?? false,
    errorMessage: history.errorMessage || "",
  };
});

function viewDownloadDetail(history: ITorrentDownloadMetadata) {
  downloadDetail.value = history;
  showDownloadDetailDialog.value = true;
}

onMounted(() => {
  throttleLoadDownloadHistory();
});

onUnmounted(() => {
  clearWatchingMap();
});
</script>

<template>
  <v-alert :title="t('route.Overview.DownloadHistory')" type="info" />
  <v-card>
    <v-card-title class="ptpp-page-toolbar">
      <v-row class="ma-0">
        <!-- 按钮组 -->
        <NavButton
          color="green"
          icon="mdi-cached"
          :text="t('DownloadHistory.refresh')"
          @click="() => throttleLoadDownloadHistory()"
        />

        <v-divider vertical class="mx-2" />

        <NavButton
          :disabled="tableSelected.length === 0"
          color="primary"
          icon="mdi-tray-arrow-down"
          :text="t('DownloadHistory.reDownload')"
          @click="() => reDownloadTorrent(tableSelected)"
        />

        <NavButton
          :disabled="tableSelected.length === 0"
          :text="t('common.remove')"
          color="error"
          icon="mdi-minus"
          @click="deleteDownloadHistory(tableSelected)"
        />

        <NavButton
          :disabled="downloadHistoryList.length === 0"
          :loading="isClearingAll"
          :text="t('DownloadHistory.clearAll')"
          color="error"
          icon="mdi-delete-sweep"
          @click="clearAllDownloadHistory"
        />

        <v-spacer />

        <!-- 筛选框 -->
        <v-text-field
          v-model="tableWaitFilterRef"
          append-icon="mdi-magnify"
          clearable
          density="compact"
          hide-details
          :label="t('DownloadHistory.filterPlaceholder')"
          max-width="500"
          prepend-inner-icon="mdi-filter"
          single-line
          @click:prepend-inner="showAdvanceFilterDialog = true"
        />
      </v-row>
    </v-card-title>
    <v-card-text>
      <ResponsiveDataTable
        action-key="action"
        :primary-keys="['siteId', 'title']"
        v-model="tableSelected"
        :custom-filter="tableFilterFn"
        :filter-keys="['id'] /* 对每个item值只检索一次 */"
        :headers="tableHeader"
        :items="downloadHistoryList"
        :items-per-page="configStore.tableBehavior.DownloadHistory.itemsPerPage"
        :multi-sort="configStore.enableTableMultiSort"
        :search="tableFilterRef"
        :sort-by="configStore.tableBehavior.DownloadHistory.sortBy"
        class="table-stripe table-header-no-wrap"
        hover
        item-value="id"
        show-select
        @update:itemsPerPage="(v: number) => configStore.updateTableBehavior('DownloadHistory', 'itemsPerPage', v)"
        @update:sortBy="(v: any[]) => configStore.updateTableBehavior('DownloadHistory', 'sortBy', v)"
      >
        <template #item.siteId="{ item }">
          <div class="d-flex flex-column align-center">
            <SiteFavicon :site-id="item.siteId" :size="18" />
            <SiteName :site-id="item.siteId" />
          </div>
        </template>

        <template #item.title="{ item }">
          <TorrentTitleTd v-if="item.torrent" :item="item.torrent" />
        </template>

        <template #item.downloaderId="{ item }">
          <DownloaderLabel :downloader="item.downloaderId" />
        </template>

        <template #item.downloadAt="{ item }">
          <span class="t_downloadAt text-no-wrap">{{ formatDate(item.downloadAt ?? 0) }}</span>
        </template>

        <template #item.downloadStatus="{ item }">
          <v-chip
            :prepend-icon="downloadStatusMap[item.downloadStatus as keyof typeof downloadStatusMap].icon"
            :color="downloadStatusMap[item.downloadStatus as keyof typeof downloadStatusMap].color"
            @click="() => viewDownloadDetail(item)"
          >
            {{ downloadStatusMap[item.downloadStatus as keyof typeof downloadStatusMap].title }}
          </v-chip>
        </template>

        <template #item.action="{ item }">
          <v-btn-group class="table-action" density="compact" variant="plain">
            <v-btn
              :title="t('DownloadHistory.reDownload')"
              color="primary"
              icon="mdi-tray-arrow-down"
              size="small"
              @click="() => reDownloadTorrent([item.id!])"
            />

            <v-btn
              :title="t('common.remove')"
              color="error"
              icon="mdi-delete"
              size="small"
              @click="() => deleteDownloadHistory([item.id!])"
            />
          </v-btn-group>
        </template>
      </ResponsiveDataTable>
    </v-card-text>
  </v-card>

  <ReDownloadSelectDialog
    v-model="showReDownloadSelectDialog"
    :torrent-items="reDownloadTorrentListRef"
    @re-download-complete="() => throttleLoadDownloadHistory()"
  />

  <AdvanceFilterGenerateDialog v-model="showAdvanceFilterDialog" />

  <DeleteDialog
    v-model="showDeleteDialog"
    :to-delete-ids="toDeleteIds"
    :confirm-delete="confirmDeleteDownloadHistory"
    @all-delete="handleDownloadHistoryDeleted"
  />

  <v-dialog v-model="showDownloadDetailDialog" :aria-label="t('DownloadHistory.details')" width="800">
    <v-card>
      <v-toolbar color="blue-grey-darken-2" density="compact">
        <v-toolbar-title>{{ t("DownloadHistory.details") }}</v-toolbar-title>
        <template #append>
          <v-btn icon="mdi-close" :title="t('common.dialog.close')" @click="showDownloadDetailDialog = false" />
        </template>
      </v-toolbar>
      <v-card-text>
        <!-- Never render the raw request object here. Torrent URLs and request
             headers may contain passkeys, cookies, or authorization tokens. -->
        <pre>{{ JSON.stringify(safeDownloadDetail, null, 2) }}</pre>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss"></style>
