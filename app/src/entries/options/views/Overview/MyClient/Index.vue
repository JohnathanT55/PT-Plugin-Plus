<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import type { DataTableHeader } from "vuetify";

import { CTorrentState, type CTorrent, getDownloaderIcon } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import { formatSize, formatDate } from "@/options/utils.ts";
import type { IClientOperationResult, TClientOperation } from "@/shared/types.ts";
import { sanitizeDownloadErrorMessage } from "@/shared/downloadError.ts";
import {
  normalizeClientRefreshInterval,
  summarizeClientOperationResults,
} from "@/shared/clientDashboard.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";

import DeleteDialog from "./DeleteDialog.vue";
import PushToDownloaderDialog from "./PushToDownloaderDialog.vue";
import TorrentStateTd from "./TorrentStateTd.vue";
import ClientStatusDialog from "./ClientStatusDialog.vue";
import NavButton from "@/options/components/NavButton.vue";

import { torrents, autoRefreshRunning, selectedDownloaderIds, useClientRefresh } from "./utils.ts";

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const configStore = useConfigStore();

const {
  enabledDownloaders,
  activeDownloaderIds,
  loadSingleDownloader,
  scheduleDownloaderRefresh,
  rescheduleActiveDownloaders,
  stopAllTimers,
  resetRefreshState,
  toggleAutoRefresh,
} = useClientRefresh();

// ── state ──────────────────────────────────────────────────────────────────
const loading = ref(false);
const operationBusy = ref(false);

const tableSelected = ref<CTorrent[]>([]);
const searchText = ref("");

// delete dialog
const showDeleteDialog = ref(false);
const toDeleteTorrents = ref<CTorrent[]>([]);

// push to downloader dialog
const showPushToDownloaderDialog = ref(false);

// client status dialog
const showClientStatusDialog = ref(false);

const totalUpSpeed = computed(() => allTorrents.value.reduce((acc, t) => acc + (t.uploadSpeed ?? 0), 0));
const totalDlSpeed = computed(() => allTorrents.value.reduce((acc, t) => acc + (t.downloadSpeed ?? 0), 0));

// ── computed ───────────────────────────────────────────────────────────────
const allTorrents = computed(() => enabledDownloaders.value.flatMap((downloader) => torrents.value[downloader.id] ?? []));
const supportedDownloaderIds = computed(() => enabledDownloaders.value.map((downloader) => downloader.id));
const downloaderFilterItems = computed(() =>
  enabledDownloaders.value.map((downloader) => ({ title: downloader.name, value: downloader.id })),
);
const selectedTorrentKeys = computed(() => new Set(tableSelected.value.map(torrentKey)));

function torrentRowProps({ item }: { item: CTorrent }) {
  return { class: selectedTorrentKeys.value.has(torrentKey(item)) ? "ptpp-selected-row" : undefined };
}

const filteredTorrents = computed(() => {
  const active = activeDownloaderIds.value;
  const base = active.flatMap((id) => torrents.value[id] ?? []);
  if (!searchText.value) return base;
  const q = searchText.value.toLowerCase();
  return base.filter(
    (t) =>
      t.name.toLowerCase().includes(q) ||
      t.infoHash.toLowerCase().includes(q) ||
      (t.label ?? "").toLowerCase().includes(q) ||
      t.savePath.toLowerCase().includes(q),
  );
});

// ── table headers ─────────────────────────────────────────────────────────
const fullTableHeader = computed(
  () =>
    [
      { title: t("MyClient.table.client"), key: "clientId", align: "center", width: "120", props: { disabled: true } },
      {
        title: t("MyClient.table.name"),
        key: "name",
        align: "start",
        minWidth: "20rem",
        props: { disabled: true },
      },
      { title: t("MyClient.table.size"), key: "totalSize", align: "end", width: "110" },
      { title: t("MyClient.table.progress"), key: "progress", align: "end", width: "90" },
      { title: t("MyClient.table.status"), key: "state", align: "center", width: "110" },
      { title: t("MyClient.table.upSpeed"), key: "uploadSpeed", align: "end", width: "100" },
      { title: t("MyClient.table.dlSpeed"), key: "downloadSpeed", align: "end", width: "100" },
      { title: t("MyClient.table.totalUploaded"), key: "totalUploaded", align: "end", width: "100" },
      { title: t("MyClient.table.totalDownloaded"), key: "totalDownloaded", align: "end", width: "100" },
      { title: t("MyClient.table.ratio"), key: "ratio", align: "end", width: "60" },
      { title: t("MyClient.table.savePath"), key: "savePath", align: "start" },
      { title: t("MyClient.table.addedAt"), key: "dateAdded", align: "center", width: "160" },
      {
        title: t("common.action"),
        key: "action",
        align: "center",
        sortable: false,
        width: "120",
        props: { disabled: true },
      },
    ] as (DataTableHeader & { props?: any })[],
);

const tableHeader = computed(
  () =>
    fullTableHeader.value.filter(
      (item) => item?.props?.disabled || (configStore.tableBehavior["MyClient"] as any)?.columns?.includes(item.key),
    ) as DataTableHeader[],
);

// ── data loading ──────────────────────────────────────────────────────────
/** Manual full refresh: fetch all active downloaders, reset error state. */
async function loadTorrents() {
  if (loading.value || operationBusy.value) return;
  loading.value = true;
  tableSelected.value = [];
  resetRefreshState();
  try {
    const results = await Promise.all(activeDownloaderIds.value.map((id) => loadSingleDownloader(id)));
    const failures = results.filter((result) => !result.success);
    if (failures.length > 0) showOperationSummary("list", results);
  } finally {
    loading.value = false;
    if (autoRefreshRunning.value) {
      for (const id of activeDownloaderIds.value) {
        scheduleDownloaderRefresh(id);
      }
    }
  }
}

watch(selectedDownloaderIds, () => {
  tableSelected.value = [];
  rescheduleActiveDownloaders();
});

onMounted(() => {
  if (configStore.download.initDownloaderTorrentOnEnter) {
    loadTorrents();
  }
});

onUnmounted(() => {
  stopAllTimers();
});

// ── actions ───────────────────────────────────────────────────────────────
async function pauseTorrents(torrents: CTorrent[]) {
  await runTorrentOperation("pause", torrents);
}

async function resumeTorrents(torrents: CTorrent[]) {
  await runTorrentOperation("resume", torrents);
}

function actionLabel(action: TClientOperation) {
  return t(`MyClient.operation.${action}`);
}

function showOperationSummary(action: TClientOperation, results: IClientOperationResult<unknown>[]) {
  const summary = summarizeClientOperationResults(action, results);
  const failedDetails = summary.downloaders
    .filter((item) => item.failedCount > 0)
    .map((item) => {
      const name = metadataStore.downloaders[item.downloaderId]?.name ?? item.downloaderId;
      return `${name}: ${item.errors.join(" / ") || t("MyClient.unknownError")}`;
    })
    .join("；");
  const details = failedDetails ? `；${failedDetails}` : "";
  runtimeStore.showSnakebar(
    t("MyClient.operation.summary", {
      action: actionLabel(action),
      success: summary.successCount,
      failed: summary.failedCount,
      details,
    }),
    { color: summary.failedCount > 0 ? (summary.successCount > 0 ? "warning" : "error") : "success", timeout: 8000 },
  );
}

async function runTorrentOperation(action: "pause" | "resume", torrentList: CTorrent[]) {
  if (torrentList.length === 0 || operationBusy.value) return;
  operationBusy.value = true;
  try {
    const results = await Promise.all(
      torrentList.map((torrent) =>
        sendMessage(action === "pause" ? "pauseClientTorrent" : "resumeClientTorrent", {
          downloaderId: torrent.clientId,
          id: torrent.id,
        }).catch(
          (error): IClientOperationResult => ({
            success: false,
            action,
            downloaderId: torrent.clientId,
            error: sanitizeDownloadErrorMessage(error) || t("MyClient.unknownError"),
          }),
        ),
      ),
    );
    showOperationSummary(action, results);
    const affectedIds = [...new Set(torrentList.map((torrent) => torrent.clientId))];
    await Promise.all(affectedIds.map(loadSingleDownloader));
    tableSelected.value = [];
  } finally {
    operationBusy.value = false;
  }
}

function openDeleteDialog(torrentList: CTorrent[]) {
  if (operationBusy.value) return;
  toDeleteTorrents.value = torrentList;
  deleteResults.value = [];
  showDeleteDialog.value = true;
}

// Called per-item by DeleteDialog
async function confirmDeleteTorrent(torrentKey_: string, removeData: boolean): Promise<void> {
  const torrent = toDeleteTorrents.value.find((t) => torrentKey(t) === torrentKey_);
  if (!torrent) return;
  operationBusy.value = true;
  const result = await sendMessage("deleteClientTorrent", {
    downloaderId: torrent.clientId,
    id: torrent.id,
    removeData,
  }).catch(
    (error): IClientOperationResult => ({
      success: false,
      action: "delete",
      downloaderId: torrent.clientId,
      error: sanitizeDownloadErrorMessage(error) || t("MyClient.unknownError"),
    }),
  );
  deleteResults.value.push(result);
}

const deleteResults = ref<IClientOperationResult[]>([]);

async function handleDeleteComplete() {
  try {
    if (deleteResults.value.length > 0) showOperationSummary("delete", deleteResults.value);
    const affectedIds = [...new Set(toDeleteTorrents.value.map((torrent) => torrent.clientId))];
    await Promise.all(affectedIds.map(loadSingleDownloader));
    tableSelected.value = [];
    toDeleteTorrents.value = [];
    deleteResults.value = [];
  } finally {
    operationBusy.value = false;
  }
}

async function updateRefreshInterval(value: number) {
  configStore.download.clientAutoRefreshInterval = normalizeClientRefreshInterval(value);
  await configStore.$save();
  rescheduleActiveDownloaders();
}

function clientName(clientId: string) {
  return metadataStore.downloaders[clientId]?.name ?? clientId;
}

function clientIcon(clientId: string) {
  const type = metadataStore.downloaders[clientId]?.type;
  return type ? getDownloaderIcon(type) : undefined;
}

function torrentKey(torrent: CTorrent) {
  return `${torrent.clientId}:${String(torrent.id)}`;
}
</script>

<template>
  <v-alert class="ptpp-section-title" :title="t('route.Overview.MyClient')" type="info">
    <template #append>
      <v-btn
        :title="t('MyClient.clientStatusDialog.openBtn')"
        class="mr-2 status-btn"
        color="primary"
        size="small"
        @click="showClientStatusDialog = true"
      >
        <v-icon class="mr-1" icon="mdi-database-outline" size="x-small" />
        {{ allTorrents.length }}
        <v-icon class="mr-1" color="green-darken-4" icon="mdi-chevron-up" size="x-small" />
        {{ formatSize(totalUpSpeed) }}/s
        <v-icon class="mr-1" color="red-darken-4" icon="mdi-chevron-down" size="x-small" />
        {{ formatSize(totalDlSpeed) }}/s
      </v-btn>
    </template>
  </v-alert>

  <v-card>
    <v-card-title class="ptpp-page-toolbar">
      <v-row class="ma-0 ga-1 flex-nowrap" align="center">
        <NavButton
          color="primary"
          icon="mdi-cloud-upload"
          :text="t('MyClient.pushToDownloader.navBtn')"
          @click="showPushToDownloaderDialog = true"
        />
        <NavButton
          :disabled="tableSelected.length === 0 || operationBusy"
          color="success"
          icon="mdi-play"
          :text="t('MyClient.resumeSelected')"
          @click="() => resumeTorrents(tableSelected)"
        />
        <NavButton
          :disabled="tableSelected.length === 0 || operationBusy"
          color="warning"
          icon="mdi-pause"
          :text="t('MyClient.pauseSelected')"
          @click="() => pauseTorrents(tableSelected)"
        />
        <NavButton
          :disabled="tableSelected.length === 0 || operationBusy"
          color="error"
          icon="mdi-delete"
          :text="t('MyClient.deleteSelected')"
          @click="() => openDeleteDialog(tableSelected)"
        />
        <NavButton
          :disabled="loading"
          color="success"
          icon="mdi-refresh"
          :text="t('MyClient.refresh')"
          @click="loadTorrents"
        />

        <!-- auto-refresh controls -->
        <v-menu :close-on-content-click="false" location="bottom">
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              :color="autoRefreshRunning ? 'blue' : 'grey'"
              :icon="autoRefreshRunning ? 'mdi-timer' : 'mdi-timer-off-outline'"
              :title="t('MyClient.autoRefresh.btnTitle')"
              class="ptpp-toolbar-icon-button"
              variant="elevated"
            />
          </template>
          <v-card min-width="240" class="pa-2">
            <v-card-subtitle class="pa-1">{{ t("MyClient.autoRefresh.intervalLabel") }}</v-card-subtitle>
            <v-number-input
              :model-value="configStore.download.clientAutoRefreshInterval"
              :label="t('MyClient.autoRefresh.intervalUnit')"
              :min="5"
              :max="3600"
              control-variant="stacked"
              hide-details
              density="compact"
              class="ma-1"
              @update:model-value="updateRefreshInterval"
            />
            <v-card-actions class="pa-1 pt-2">
              <v-btn
                :color="autoRefreshRunning ? 'error' : 'success'"
                :prepend-icon="autoRefreshRunning ? 'mdi-stop' : 'mdi-play'"
                block
                variant="tonal"
                @click="toggleAutoRefresh"
              >
                {{ autoRefreshRunning ? t("MyClient.autoRefresh.stop") : t("MyClient.autoRefresh.start") }}
              </v-btn>
            </v-card-actions>
          </v-card>
        </v-menu>

        <!-- column selector -->
        <v-combobox
          v-model="(configStore.tableBehavior['MyClient'] as any).columns"
          :items="fullTableHeader"
          :return-object="false"
          chips
          class="table-header-filter-clear my-client-column-selector"
          density="compact"
          hide-details
          item-value="key"
          max-width="200"
          multiple
          prepend-inner-icon="mdi-filter-cog"
          :title="t('MyClient.columnSelector')"
          @update:model-value="(v) => configStore.updateTableBehavior('MyClient', 'columns', v)"
        >
          <template #chip="{ item, index }">
            <v-chip v-if="index === 0">
              <span>{{ item.title }}</span>
            </v-chip>
            <span v-if="index === 1" class="grey--text caption">
              (+{{ (configStore.tableBehavior["MyClient"] as any).columns!.length - 1 }})
            </span>
          </template>
        </v-combobox>

        <v-select
          v-model="selectedDownloaderIds"
          :items="downloaderFilterItems"
          :label="t('MyClient.autoRefresh.downloaderFilter')"
          chips
          class="my-client-downloader-filter"
          clearable
          density="compact"
          hide-details
          max-width="260"
          multiple
        />

        <v-spacer />

        <v-text-field
          v-model="searchText"
          append-icon="mdi-magnify"
          clearable
          density="compact"
          hide-details
          :label="t('MyClient.searchPlaceholder')"
          class="my-client-search"
          max-width="360"
          single-line
        />
      </v-row>
    </v-card-title>

    <v-card-text>
      <v-data-table
        v-model="tableSelected"
        :headers="tableHeader"
        :items="filteredTorrents"
        :items-per-page="configStore.tableBehavior['MyClient']?.itemsPerPage ?? 25"
        :items-per-page-options="[10, 25, 50]"
        :item-value="torrentKey"
        :loading="loading"
        :multi-sort="configStore.enableTableMultiSort"
        :sort-by="configStore.tableBehavior['MyClient']?.sortBy"
        class="table-stripe table-header-no-wrap table-td-p4"
        hover
        return-object
        :row-props="torrentRowProps"
        show-select
        @update:itemsPerPage="(v: number) => configStore.updateTableBehavior('MyClient', 'itemsPerPage', v)"
        @update:sortBy="(v: any[]) => configStore.updateTableBehavior('MyClient', 'sortBy', v)"
      >
        <!-- client column -->
        <template #item.clientId="{ item }">
          <div class="d-flex flex-column align-center">
            <v-avatar :image="clientIcon(item.clientId)" size="22" />
            <span class="text-caption text-no-wrap mt-1">{{ clientName(item.clientId) }}</span>
          </div>
        </template>

        <!-- name column -->
        <template #item.name="{ item }">
          <div>
            <span class="font-weight-medium">{{ item.name }}</span>
            <div v-if="item.label" class="text-caption text-grey">
              <v-icon size="x-small" icon="mdi-label-outline" /> {{ item.label }}
            </div>
          </div>
        </template>

        <!-- size column -->
        <template #item.totalSize="{ item }">
          <span class="text-no-wrap">{{ formatSize(item.totalSize) }}</span>
        </template>

        <!-- progress column -->
        <template #item.progress="{ item }">
          <v-progress-circular
            :model-value="item.progress"
            :size="36"
            :width="3"
            :color="item.isCompleted ? 'green' : 'blue'"
          >
            <span class="text-caption">{{ item.progress.toFixed(0) }}%</span>
          </v-progress-circular>
        </template>

        <!-- state column -->
        <template #item.state="{ item }">
          <TorrentStateTd :item="item" />
        </template>

        <!-- upload speed -->
        <template #item.uploadSpeed="{ item }">
          <span v-if="item.uploadSpeed > 0" class="text-no-wrap text-green-darken-2">
            {{ formatSize(item.uploadSpeed) }}/s
          </span>
          <span v-else class="text-grey">-</span>
        </template>

        <!-- download speed -->
        <template #item.downloadSpeed="{ item }">
          <span v-if="item.downloadSpeed > 0" class="text-no-wrap text-blue-darken-2">
            {{ formatSize(item.downloadSpeed) }}/s
          </span>
          <span v-else class="text-grey">-</span>
        </template>

        <!-- total uploaded -->
        <template #item.totalUploaded="{ item }">
          <span class="text-no-wrap text-green-darken-2">{{ formatSize(item.totalUploaded) }}</span>
        </template>

        <!-- total downloaded -->
        <template #item.totalDownloaded="{ item }">
          <span class="text-no-wrap text-blue-darken-2">{{ formatSize(item.totalDownloaded) }}</span>
        </template>

        <!-- ratio column -->
        <template #item.ratio="{ item }">
          <span :class="item.ratio >= 1 ? 'text-green' : 'text-red'">
            {{ item.ratio.toFixed(2) }}
          </span>
        </template>

        <!-- save path -->
        <template #item.savePath="{ item }">
          <span class="text-caption text-no-wrap">{{ item.savePath }}</span>
        </template>

        <!-- date added -->
        <template #item.dateAdded="{ item }">
          <span class="text-no-wrap text-caption">{{ formatDate(item.dateAdded * 1000) }}</span>
        </template>

        <!-- actions -->
        <template #item.action="{ item }">
          <v-btn-group class="table-action" density="compact" variant="plain">
            <v-btn
              v-if="item.state === CTorrentState.downloading || item.state === CTorrentState.seeding"
              :disabled="operationBusy"
              :title="t('MyClient.action.pause')"
              color="warning"
              icon="mdi-pause"
              size="small"
              @click="() => pauseTorrents([item])"
            />
            <v-btn
              v-else-if="item.state === CTorrentState.paused || item.state === CTorrentState.error"
              :disabled="operationBusy"
              :title="t('MyClient.action.resume')"
              color="success"
              icon="mdi-play"
              size="small"
              @click="() => resumeTorrents([item])"
            />

            <v-btn
              :disabled="operationBusy"
              :title="t('MyClient.action.delete')"
              color="error"
              icon="mdi-delete"
              size="small"
              @click="() => openDeleteDialog([item])"
            />
          </v-btn-group>
        </template>
      </v-data-table>
    </v-card-text>
  </v-card>

  <DeleteDialog
    v-model="showDeleteDialog"
    :to-delete-ids="toDeleteTorrents.map((t) => torrentKey(t))"
    :confirm-delete="confirmDeleteTorrent"
    @all-delete="handleDeleteComplete"
  />

  <PushToDownloaderDialog v-model="showPushToDownloaderDialog" :allowed-downloader-ids="supportedDownloaderIds" />

  <ClientStatusDialog v-model="showClientStatusDialog" />
</template>

<style scoped lang="scss">
.table-td-p4 :deep(.v-data-table__td) {
  padding: 0 4px;
}

.ptpp-toolbar-icon-button {
  height: 36px !important;
  min-height: 36px !important;
  width: 36px;
}

.my-client-column-selector,
.my-client-downloader-filter,
.my-client-search {
  min-width: 170px;
}

@media (max-width: 1280px) {
  .my-client-column-selector {
    display: none;
  }

  .my-client-search {
    max-width: 260px !important;
  }
}
</style>
