<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { useDisplay, type DataTableHeader } from "vuetify";
import { EResultParseStatus, ETorrentStatus } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate, formatSize, formatTimeAgo } from "@/options/utils.ts";
import type { ISearchResultTorrent } from "@/shared/types.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import TorrentTitleTd from "@/options/components/TorrentTitleTd.vue";
import ResponsiveDataTable from "@/options/components/ResponsiveDataTable.vue";

import ActionTd from "./ActionTd.vue";
import TorrentProcessTd from "./TorrentProcessTd.vue";
import QuickFilterNotice from "./QuickFilterNotice.vue";
import SearchStatusDialog from "./SearchStatusDialog.vue";
import SaveSnapshotDialog from "./SaveSnapshotDialog.vue";
import AdvanceFilterGenerateDialog from "./AdvanceFilterGenerateDialog.vue";

// 主要助手方法
import { tableCustomFilter } from "./utils/filter";
import {
  beginSearchRun,
  doSearch,
  isCurrentSearchRun,
  retrySearch,
  searchPlanStatus,
  searchQueue,
} from "./utils/search";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const display = useDisplay();

const showAdvanceFilterGenerateDialog = ref<boolean>(false);
const showSearchStatusDialog = ref<boolean>(false);
const showSaveSnapshotDialog = ref<boolean>(false);

const fullTableHeader = computed(
  () =>
    [
      { title: t("common.site"), key: "site", align: "center", props: { disabled: true } },
      {
        title: t("SearchEntity.index.table.title"),
        key: "title",
        align: "start",
        minWidth: "clamp(18rem, 28vw, 26rem)",
        ...(configStore.searchEntifyControl.limitTorrentTitleTdWidth || display.smAndDown.value
          ? { maxWidth: "32vw" }
          : {}),
        props: { disabled: true },
      },
      { title: t("SearchEntity.index.table.category"), key: "category", align: "center" },
      { title: t("SearchEntity.index.table.size"), key: "size", align: "end" },
      { title: t("SearchEntity.index.table.seeders"), key: "seeders", align: "end" },
      { title: t("SearchEntity.index.table.leechers"), key: "leechers", align: "end" },
      { title: t("SearchEntity.index.table.completed"), key: "completed", align: "end" },
      { title: t("SearchEntity.index.table.comments"), key: "comments", align: "end" },
      { title: t("SearchEntity.index.table.time"), key: "time", align: "center" },
      {
        title: t("common.action"),
        key: "action",
        align: "center",
        fixed: "end",
        width: "11rem",
        minWidth: "11rem",
        sortable: false,
        headerProps: { class: "ptpp-search-action-column" },
        cellProps: { class: "ptpp-search-action-column" },
        props: { disabled: true },
      },
    ] as (DataTableHeader & { props?: any })[],
);

const tableHeader = computed(() => {
  return fullTableHeader.value.filter(
    (item) => item?.props?.disabled || configStore.tableBehavior.SearchEntity.columns!.includes(item.key!),
  ) as DataTableHeader[];
});

const { tableFilterRef, tableWaitFilterRef, tableFilterFn, buildAdvanceItemPropsFn, buildFilterDictFn } =
  tableCustomFilter;

// 使用 shallowRef 优化：种子对象数组不需要深度响应式，提升性能
const tableSelectedRaw = shallowRef<ISearchResultTorrent[]>([]);
const selectedTorrentIds = computed(() => new Set(tableSelectedRaw.value.map((torrent) => torrent.uniqueId)));
function searchResultRowProps({ item }: { item: ISearchResultTorrent }) {
  const selected = selectedTorrentIds.value.has(item.uniqueId);
  return {
    class: selected ? "ptpp-selected-row" : undefined,
    "aria-selected": selected ? "true" : "false",
  };
}

watch(
  () => route.query,
  (newParams, oldParams) => {
    if (newParams.snapshot) {
      const snapshotRunId = beginSearchRun();
      tableSelectedRaw.value = [];
      metadataStore.getSearchSnapshotData(newParams.snapshot as string).then((data) => {
        if (!data || !isCurrentSearchRun(snapshotRunId)) return;
        runtimeStore.search = { ...data, snapshot: newParams.snapshot as string };
        // 如果启用了快速站点筛选，则重置一下筛选器，以防止快速站点筛选中无站点数据
        if (configStore.searchEntity.quickSiteFilter) {
          buildAdvanceItemPropsFn();
        }
      });
    } else {
      if (
        newParams.flush ||
        (newParams.search && newParams.search != oldParams?.search) ||
        (newParams.plan && newParams.plan != oldParams?.plan)
      ) {
        const searchKey = (newParams.search as string) ?? "";
        const searchPlanKey = (newParams.plan as string) ?? "default";
        // 清理已选择项 （ #622 ）
        tableSelectedRaw.value = [];
        // 搜索词只用路由完成当次页面内交接。立即替换为无敏感参数的 URL，
        // 避免普通搜索词进入浏览器历史或会话恢复数据。快照 ID 属于用户主动持久化，不走此分支。
        void router.replace({ name: "SearchEntity" });
        // doSearch 会自动处理过滤器重置
        void doSearch(searchKey, searchPlanKey, true);
      }
    }
  },
  { immediate: true, deep: true },
);

const isSearchingParsed = ref<boolean>(searchQueue.isPaused);

function pauseSearchQueue() {
  console.log("pauseSearchQueue", searchQueue);
  searchQueue.pause();
  isSearchingParsed.value = true;
}

function startSearchQueue() {
  console.log("startSearchQueue", searchQueue);
  searchQueue.start();
  isSearchingParsed.value = false;
}

function cancelSearchQueue() {
  console.log("cancelSearchQueue", searchQueue);
  beginSearchRun(); // 清空搜索队列，并使已经发出的旧请求结果失效
  // 将搜索队列中状态设置为跳过
  for (const plan of Object.values(runtimeStore.search.searchPlan)) {
    if (plan.status === EResultParseStatus.waiting || plan.status === EResultParseStatus.working) {
      plan.status = EResultParseStatus.passParse;
      plan.statusMsg = "i18n.userCancel";
    }
  }

  runtimeStore.search.isSearching = false;
}

const tableNonBooleanControlKey = ["maxTagCountBeforeGroup", "hiddenTagNames"];

// 过滤出表格控制中非布尔类型的键
const filteredTableBooleanControlKeys = computed(() => {
  return Object.keys(configStore.searchEntifyControl).filter(
    (key) => tableNonBooleanControlKey.indexOf(key) === -1,
  ) as (keyof typeof configStore.searchEntifyControl)[];
});

const hiddenTagNamesText = computed({
  get: () => configStore.searchEntifyControl.hiddenTagNames.join("\n"),
  set: (val: string) => {
    configStore.searchEntifyControl.hiddenTagNames = val
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
  },
});
</script>
<template>
  <v-alert class="ptpp-search-status" type="info">
    <div class="ptpp-search-status-content">
      <div class="ptpp-search-status-text">
        <template v-if="runtimeStore.search.startAt === 0">
          {{ t("SearchEntity.index.alert.enterKeyword") }}
        </template>
        <template v-else-if="runtimeStore.search.isSearching">
          <template v-if="isSearchingParsed">
            {{ t("SearchEntity.index.alert.paused") }}
          </template>
          <template v-else-if="runtimeStore.search.searchResult.length > 0">
            {{ t("SearchEntity.index.alert.plan") }}
            [{{ metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey) }}]，
            {{ t("SearchEntity.index.alert.keyword") }}
            [{{ runtimeStore.search.searchKey }}]，
            {{ t("SearchEntity.index.alert.searchProgress", [runtimeStore.search.searchResult.length]) }}
          </template>
          <template v-else>
            {{ t("SearchEntity.index.alert.searching") }}
          </template>
        </template>
        <template v-else>
          <template v-if="runtimeStore.search.snapshot">
            {{ t("SearchEntity.index.alert.snapshot") }}
            [{{ metadataStore.snapshots[runtimeStore.search.snapshot].name }}]，
          </template>
          <template v-else>
            {{ t("SearchEntity.index.alert.plan") }}
            [{{ metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey) }}]，
          </template>
          {{ t("SearchEntity.index.alert.keyword") }}
          [{{ runtimeStore.search.searchKey }}]，
          {{ t("SearchEntity.index.alert.results", [runtimeStore.search.searchResult.length]) }}
          {{ t("SearchEntity.index.alert.duration", [(runtimeStore.searchCostTime / 1000).toFixed(1)]) }}
        </template>
      </div>

      <div v-if="runtimeStore.search.startAt !== 0" class="ptpp-search-status-actions">
        <v-btn
          v-if="runtimeStore.search.isSearching && isSearchingParsed"
          :title="t('SearchEntity.index.action.start')"
          icon="mdi-play"
          size="small"
          variant="text"
          @click="startSearchQueue"
        />
        <v-btn
          v-if="runtimeStore.search.isSearching && !isSearchingParsed"
          :title="t('SearchEntity.index.action.pause')"
          icon="mdi-pause"
          size="small"
          variant="text"
          @click="pauseSearchQueue"
        />
        <v-btn
          v-if="runtimeStore.search.isSearching"
          :title="t('SearchEntity.index.action.cancel')"
          icon="mdi-cancel"
          size="small"
          variant="text"
          @click="cancelSearchQueue"
        />
        <v-btn
          v-else
          :disabled="isSearchingParsed"
          :title="t('SearchEntity.index.action.retry')"
          icon="mdi-cached"
          size="small"
          variant="text"
          @click="doSearch(null as unknown as string, null as unknown as string, true)"
        />
        <v-btn
          v-if="searchPlanStatus.error > 0"
          :title="t('SearchEntity.index.action.retryFailed')"
          icon="mdi-sync-alert"
          size="small"
          variant="text"
          @click="retrySearch"
        />
        <v-btn
          :title="t('SearchEntity.index.alert.searchStatus')"
          class="ptpp-status-count"
          size="small"
          variant="text"
          @click="showSearchStatusDialog = true"
        >
          <template v-if="searchPlanStatus.success > 0">
            <v-icon class="mr-1" icon="mdi-check" size="x-small" />{{ searchPlanStatus.success }}
          </template>
          <template v-if="searchPlanStatus.error > 0">
            <v-icon class="ml-2 mr-1" icon="mdi-alert" size="x-small" />{{ searchPlanStatus.error }}
          </template>
          <template v-if="searchPlanStatus.queued > 0">
            <v-icon class="ml-2 mr-1" icon="mdi-clock" size="x-small" />{{ searchPlanStatus.queued }}
          </template>
        </v-btn>
      </div>
    </div>
  </v-alert>

  <v-card class="ptpp-search-card">
    <v-card-title class="ptpp-search-header">
      <div class="ptpp-result-filter-row">
        <QuickFilterNotice />

        <v-text-field
          v-model="tableWaitFilterRef"
          append-inner-icon="mdi-magnify"
          class="ptpp-result-filter"
          clearable
          density="compact"
          hide-details
          :label="t('SearchEntity.index.filterLabel')"
          prepend-inner-icon="mdi-filter"
          single-line
          variant="underlined"
          @click:prepend-inner="showAdvanceFilterGenerateDialog = true"
          @update:model-value="buildFilterDictFn"
        />
      </div>
    </v-card-title>

    <div class="ptpp-batch-toolbar">
      <template v-if="tableSelectedRaw.length > 0">
        <ActionTd
          :torrent-items="tableSelectedRaw"
          density="compact"
          show-favorite-btn
          show-keep-upload-btn
          show-labels
        />
      </template>

      <v-btn
        :disabled="runtimeStore.search.isSearching || runtimeStore.search.searchResult.length === 0"
        :title="t('SearchEntity.index.action.saveSnapshot')"
        class="ptpp-batch-extra ptpp-snapshot-button"
        color="cyan-darken-1"
        size="small"
        variant="elevated"
        @click="showSaveSnapshotDialog = true"
      >
        <v-icon icon="mdi-camera-plus" />
        <span class="ml-1">{{ t("SearchEntity.index.action.saveSnapshot") }}</span>
      </v-btn>

      <v-menu :close-on-content-click="false" location="bottom end">
        <template #activator="{ props }">
          <v-btn
            v-bind="props"
            :title="t('SearchEntity.index.action.displayPreferences')"
            class="ptpp-batch-extra ptpp-settings-button"
            color="blue"
            icon="mdi-cog"
            size="small"
            variant="elevated"
          />
        </template>

        <v-card class="ptpp-search-preferences" width="430">
          <v-list density="compact">
            <v-list-item v-for="item in filteredTableBooleanControlKeys" :key="item">
              <v-switch
                v-model="configStore.searchEntifyControl[item]"
                :label="t('SearchEntity.index.' + item)"
                color="success"
                density="compact"
                hide-details
                @click.stop
                @update:model-value="configStore.$save"
              />
            </v-list-item>

            <v-list-item v-if="configStore.searchEntifyControl.showTorrentTag">
              <v-textarea
                v-model="hiddenTagNamesText"
                :label="t('SetBase.searchEntity.hiddenTagNames')"
                clearable
                hide-details
                rows="4"
              />
            </v-list-item>

            <v-divider class="my-2" />

            <v-list-item>
              <v-combobox
                v-model="configStore.tableBehavior.SearchEntity.columns"
                :items="fullTableHeader"
                :label="t('MyData.index.selectColumns')"
                :return-object="false"
                chips
                density="compact"
                hide-details
                item-value="key"
                multiple
                prepend-inner-icon="mdi-filter-cog"
                @update:model-value="(value) => configStore.updateTableBehavior('SearchEntity', 'columns', value)"
              />
            </v-list-item>
          </v-list>
        </v-card>
      </v-menu>
    </div>

    <ResponsiveDataTable
      action-key="action"
      :primary-keys="['site', 'title']"
      id="ptpp-search-entity-table"
      v-model="tableSelectedRaw"
      :custom-filter="tableFilterFn"
      density="compact"
      :filter-keys="['uniqueId']"
      :headers="tableHeader"
      :items="runtimeStore.search.searchResult"
      :items-per-page="configStore.tableBehavior.SearchEntity.itemsPerPage"
      :items-per-page-options="[10, 25, 50]"
      :multi-sort="configStore.enableTableMultiSort"
      :search="tableFilterRef"
      :sort-by="configStore.tableBehavior.SearchEntity.sortBy"
      class="ptpp-search-entity-table table-header-no-wrap"
      hover
      item-value="uniqueId"
      return-object
      :row-props="searchResultRowProps"
      show-select
      :top-scrollbar-label="t('SearchEntity.index.horizontalScroll')"
      @update:itemsPerPage="(value: number) => configStore.updateTableBehavior('SearchEntity', 'itemsPerPage', value)"
      @update:sortBy="(value: any[]) => configStore.updateTableBehavior('SearchEntity', 'sortBy', value)"
    >
      <template #item.site="{ item }">
        <div class="d-flex flex-column align-center">
          <SiteFavicon :site-id="item.site" :size="configStore.searchEntifyControl.showSiteName ? 18 : 24" />
          <SiteName v-if="configStore.searchEntifyControl.showSiteName" :site-id="item.site" />
        </div>
      </template>

      <template #item.title="{ item }">
        <TorrentTitleTd :item="item" />
      </template>

      <template #item.size="{ item }">
        <v-container class="pa-0">
          <v-row no-gutters>
            <v-col class="pa-0">
              <span class="t_size text-no-wrap">{{ formatSize(item.size ?? 0) }}</span>
            </v-col>
          </v-row>
          <v-row v-if="item.status && (item.status as ETorrentStatus) !== ETorrentStatus.unknown" no-gutters>
            <v-col class="pa-0">
              <TorrentProcessTd :torrent="item" />
            </v-col>
          </v-row>
        </v-container>
      </template>

      <template #item.seeders="{ item }">
        <span class="t_seeders text-no-wrap">{{ item.seeders }}</span>
      </template>
      <template #item.leechers="{ item }">
        <span class="t_leechers text-no-wrap">{{ item.leechers }}</span>
      </template>
      <template #item.completed="{ item }">
        <span class="t_completed text-no-wrap">{{ item.completed }}</span>
      </template>
      <template #item.comments="{ item }">
        <span class="t_comments text-no-wrap">{{ item.comments }}</span>
      </template>

      <template #item.time="{ item }">
        <span class="t_time text-no-wrap" :title="item.time ? (formatDate(item.time) as string) : '-'">
          {{
            item.time
              ? configStore.searchEntifyControl.uploadAtFormatAsAlive
                ? formatTimeAgo(item.time)
                : formatDate(item.time)
              : "-"
          }}
        </span>
      </template>

      <template #item.action="{ item }">
        <ActionTd :torrent-items="[item]" density="compact" show-favorite-btn :show-keep-upload-btn="false" />
      </template>
    </ResponsiveDataTable>
  </v-card>

  <AdvanceFilterGenerateDialog v-model="showAdvanceFilterGenerateDialog" />
  <SearchStatusDialog v-model="showSearchStatusDialog" />
  <SaveSnapshotDialog v-model="showSaveSnapshotDialog" />
</template>

<style scoped lang="scss">
.ptpp-search-status {
  border-radius: 0;
  margin-bottom: 8px;
  padding: 8px 12px;
}

.ptpp-search-status-content {
  align-items: center;
  display: flex;
  gap: 12px;
  min-height: 32px;
}

.ptpp-search-status-text {
  flex: 1 1 auto;
  min-width: 0;
}

.ptpp-search-status-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;

  :deep(.v-btn) {
    color: #fff;
  }
}

.ptpp-status-count {
  min-width: auto;
}

.ptpp-search-card {
  overflow: visible;
}

.ptpp-search-header {
  min-height: auto;
  padding: 7px 8px;
}

.ptpp-result-filter-row {
  align-items: flex-start;
  display: flex;
  gap: 16px;
  width: 100%;
}

.ptpp-result-filter {
  flex: 0 1 460px;
  margin-top: 1px;
  max-width: 460px;
  min-width: 260px;
}

.ptpp-result-filter:deep(.v-field) {
  border-radius: 0;
  font-size: 13px;
}

.ptpp-batch-toolbar {
  align-items: center;
  background: var(--ptpp-card-background);
  border-bottom: 1px solid var(--ptpp-divider);
  border-top: 1px solid var(--ptpp-divider);
  box-shadow: 0 3px 5px -3px rgba(0, 0, 0, 0.35);
  display: flex;
  flex-wrap: nowrap;
  gap: 6px;
  height: 52px;
  min-height: 52px;
  overflow-x: auto;
  overflow-y: hidden;
  padding: 8px;
  position: sticky;
  top: 64px;
  z-index: 3;
}

.ptpp-batch-extra {
  border-radius: 2px;
  flex: 0 0 auto;
  height: 32px;
}

.ptpp-snapshot-button {
  color: #fff;
}

.ptpp-settings-button {
  color: #fff;
  width: 48px;
}

.ptpp-search-entity-table {
  width: 100%;
}

.ptpp-search-card :deep(#ptpp-search-entity-table .v-data-table__th),
.ptpp-search-card :deep(#ptpp-search-entity-table .v-data-table__td) {
  font-size: 12px;
  padding: 9px 8px !important;
}

.ptpp-search-card :deep(#ptpp-search-entity-table tbody .v-data-table__tr:nth-child(even) .v-data-table__td) {
  background: var(--ptpp-table-stripe);
}

.ptpp-search-card :deep(#ptpp-search-entity-table tbody .v-data-table__tr.ptpp-selected-row .v-data-table__td) {
  background: var(--ptpp-table-active) !important;
}

.ptpp-search-card :deep(#ptpp-search-entity-table .ptpp-responsive-action-column) {
  box-shadow: -1px 0 var(--ptpp-divider);
  white-space: nowrap;
}

.ptpp-search-card :deep(#ptpp-search-entity-table .v-data-table-footer__items-per-page .v-select),
.ptpp-search-card :deep(#ptpp-search-entity-table .v-data-table-footer__items-per-page .v-input) {
  min-width: 104px;
}

@media (max-width: 960px) {
  .ptpp-result-filter-row {
    flex-direction: column;
    gap: 6px;
  }

  .ptpp-result-filter {
    flex-basis: auto;
    max-width: none;
    min-width: 0;
    width: 100%;
  }
}
</style>
