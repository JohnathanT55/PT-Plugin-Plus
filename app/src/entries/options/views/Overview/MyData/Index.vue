<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { watchDebounced } from "@vueuse/core";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { isUndefined } from "es-toolkit/compat";
import type { DataTableHeader } from "vuetify";
import { EResultParseStatus, type ISiteUserConfig, type IUserInfo, type TSiteID } from "@ptd/site";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useTableCustomFilter } from "@/options/directives/useAdvanceFilter.ts";
import { formatDate, formatSize, formatTimeAgo } from "@/options/utils.ts";

import SiteName from "@/options/components/SiteName.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import ResultParseStatus from "@/options/components/ResultParseStatus.vue";
import NavButton from "@/options/components/NavButton.vue";
import UserLevelRequirementsTd from "./UserLevelRequirementsTd.vue";
import BonusFormatSpan from "./BonusFormatSpan.vue";

import { formatRatio } from "./utils/format.ts";
import { tableData, initTableData, cancelFlushSiteLastUserInfo, flushSiteLastUserInfo } from "./utils/lastUserData.ts";

const { t } = useI18n();
const router = useRouter();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

type TExtendDataTableHeader = DataTableHeader & { props?: any };

const fullTableHeader = reactive([
  {
    title: t("common.site"),
    key: "siteUserConfig.sortIndex",
    align: "center",
    props: { disabled: true },
  },
  { title: t("common.username"), key: "name", align: "center" },
  { title: t("MyData.table.levelName"), key: "levelName", align: "start", width: "15%" },
  // NOTE: 这里将key设为 uploaded, trueUploaded 而不是虚拟的 userData，可以让 v-data-table 使用 uploaded 的进行排序
  { title: t("MyData.table.userData"), key: "uploaded", align: "end" },
  { title: t("MyData.table.trueUserData"), key: "trueUploaded", align: "end" }, // 默认不显示
  { title: t("levelRequirement.ratio"), key: "ratio", align: "end" },
  { title: t("levelRequirement.trueRatio"), key: "trueRatio", align: "end" }, // 默认不显示
  { title: t("levelRequirement.uploads"), key: "uploads", align: "end" },
  { title: t("levelRequirement.seeding"), key: "seeding", align: "end" },
  { title: t("levelRequirement.seedingSize"), key: "seedingSize", align: "end" },
  { title: t("levelRequirement.bonus"), key: "bonus", align: "end" },
  { title: t("levelRequirement.bonusPerHour"), key: "bonusPerHour", align: "end" },
  { title: t("MyData.table.invites"), key: "invites", align: "end" }, // 默认不显示
  { title: t("MyData.table.joinTime"), key: "joinTime", align: "center" },
  { title: t("MyData.table.lastAccessAt"), key: "lastAccessAt", align: "center" }, // 默认不显示
  { title: t("MyData.table.updateAt"), key: "updateAt", align: "center" },
  { title: t("MyData.table.status"), key: "status", align: "center", sortable: false, props: { disabled: true } },
] as TExtendDataTableHeader[]);

const tableHeader = computed(() => {
  return fullTableHeader.filter(
    (item: TExtendDataTableHeader) =>
      item?.props?.disabled || configStore.tableBehavior.MyData.columns!.includes(item.key!),
  ) as DataTableHeader[];
});

const tableNonBooleanControlKey = [
  "joinTimeFormat",
  // Deprecated
  "joinTimeWeekOnly",
];

// 过滤出表格控制中非布尔类型的键
const filteredTableBooleanControlKeys = computed(() => {
  return Object.keys(configStore.myDataTableControl).filter(
    (key) => tableNonBooleanControlKey.indexOf(key) === -1,
  ) as (keyof typeof configStore.myDataTableControl)[];
});

interface IUserInfoItem extends IUserInfo {
  siteUserConfig: ISiteUserConfig;
  siteName: string;
}

const {
  tableWaitFilterRef,
  tableFilterRef,
  tableFilterFn,
  buildFilterDictFn,
} = useTableCustomFilter<IUserInfoItem>({
  parseOptions: {
    keywords: ["site", "status", "siteUserConfig.groups"],
    ranges: ["updateAt", "messageCount"],
  },
  titleFields: ["site", "siteName", "name"],
  format: {
    status: "number",
  },
});

async function initPtppTable() {
  const columns = configStore.tableBehavior.MyData.columns ?? [];
  // The imported PTD defaults used an action column and absolute dates. Treat
  // that exact marker as an old UI preference and switch it to the PTPP view.
  if (columns.includes("action")) {
    configStore.tableBehavior.MyData.columns = [...columns.filter((column) => column !== "action"), "bonusPerHour"];
    configStore.tableBehavior.MyData.itemsPerPage = -1;
    configStore.myDataTableControl.joinTimeFormat = "alive";
    configStore.myDataTableControl.updateAtFormatAsAlive = true;
    await configStore.$save();
  }
  await initTableData();
}

onMounted(() => void initPtppTable());

// 监听用户信息变化（ offscreen 直接定时刷新的情况 ）
watchDebounced(
  () => metadataStore.lastUserInfo,
  () => {
    // 此时前端并没有进行刷新，强制更新
    if (!Object.values(runtimeStore.userInfo.flushPlan).some((isFlushing) => isFlushing)) {
      initTableData();
    }
  },
  { debounce: 5e3, deep: true },
);

async function multiFlush() {
  const flushSiteIds: TSiteID[] = tableData.value.map((item) => item.site);

  if (flushSiteIds.length > 0) {
    flushSiteLastUserInfo(flushSiteIds);
  } else {
    runtimeStore.showSnakebar(t("MyData.index.noSiteSelectedCancelRefresh"), { color: "warning" });
  }
}

function viewTimeline() {
  router.push({ name: "UserDataTimeline" });
}

function viewStatistic() {
  router.push({ name: "UserDataStatistic" });
}
</script>

<template>
  <v-alert class="ptpp-section-title" :title="t('route.Overview.MyData')" type="info" />
  <v-card class="ptpp-my-data-card">
    <v-card-title class="ptpp-my-data-toolbar">
      <v-row align="center" class="ma-0 ga-2">
        <!-- 刷新，取消刷新 -->
        <NavButton
          v-if="runtimeStore.isUserInfoFlush"
          :text="t('MyData.index.flushCancel')"
          color="red"
          icon="mdi-cancel"
          @click="cancelFlushSiteLastUserInfo"
        />

        <NavButton
          v-else
          :text="t('MyData.index.flushSelectSite')"
          color="green"
          icon="mdi-cached"
          @click="multiFlush"
        />

        <v-btn
          color="green"
          icon="mdi-chart-timeline-variant"
          :title="t('MyData.index.viewTimeline')"
          @click="viewTimeline"
        />
        <v-btn color="green" icon="mdi-equalizer" :title="t('MyData.index.viewStatistic')" @click="viewStatistic" />

        <v-menu :close-on-content-clicks="false">
          <template v-slot:activator="{ props }">
            <NavButton color="blue" icon="mdi-cog" :text="t('MyData.index.setting')" class="mr-1" v-bind="props" />
          </template>
          <v-list>
            <!-- 入站时间显示 -->
            <v-list-item>
              <template v-slot:prepend>
                <v-list-item-action start class="ml-2">
                  <v-icon icon="mdi-calendar-account" class="mr-2" />
                  <span class="text-subtitle-2">{{ t("MyData.index.joinTimeFormat") }}</span>
                </v-list-item-action>
              </template>

              <v-btn-toggle
                v-model="configStore.myDataTableControl.joinTimeFormat"
                density="compact"
                hide-details
                class="ml-2"
                @click.stop
                @update:model-value="() => configStore.$save()"
              >
                <v-btn
                  v-for="type in ['alive', 'aliveWeek', 'added']"
                  :key="type"
                  :value="type"
                  :title="t(`MyData.index.joinTimeFormatOptions.${type}`)"
                  density="compact"
                  hide-details
                >
                  {{ t(`MyData.index.joinTimeFormatOptions.${type}`) }}
                </v-btn>
              </v-btn-toggle>
            </v-list-item>

            <v-divider />

            <!-- 其他开关控制 -->
            <v-list-item v-for="index in filteredTableBooleanControlKeys" :key="index" :value="index">
              <template v-slot:prepend>
                <v-list-item-action start class="ml-2">
                  <v-switch
                    v-model="configStore.myDataTableControl[index]"
                    :label="`&nbsp;${t('MyData.index.' + index)}`"
                    color="success"
                    density="compact"
                    hide-details
                    @click.stop
                    @update:model-value="() => configStore.$save()"
                  />
                </v-list-item-action>
              </template>
            </v-list-item>
          </v-list>
        </v-menu>

        <v-combobox
          v-model="configStore.tableBehavior.MyData.columns"
          :items="fullTableHeader"
          :return-object="false"
          chips
          class="table-header-filter-clear"
          density="compact"
          hide-details
          item-value="key"
          max-width="240"
          multiple
          prepend-inner-icon="mdi-filter-cog"
          @update:model-value="(v) => configStore.updateTableBehavior('MyData', 'columns', v)"
        >
          <template #chip="{ item, index }">
            <v-chip v-if="index === 0">
              <span>{{ item.title }}</span>
            </v-chip>
            <span v-if="index === 1" class="text-grey caption">
              (+{{ configStore.tableBehavior.MyData.columns!.length - 1 }})
            </span>
          </template>
        </v-combobox>

        <v-spacer />

        <v-text-field
          v-model="tableWaitFilterRef"
          append-icon="mdi-magnify"
          clearable
          density="compact"
          hide-details
          :label="t('common.search')"
          max-width="460"
          single-line
          @click:clear="buildFilterDictFn('')"
        />
      </v-row>
    </v-card-title>
    <v-data-table
      :custom-filter="tableFilterFn"
      :filter-keys="['site'] /* 对每个item值只检索一次 */"
      :headers="tableHeader"
      :items="tableData"
      :items-per-page="configStore.tableBehavior.MyData.itemsPerPage"
      :multi-sort="configStore.enableTableMultiSort"
      :search="tableFilterRef"
      :sort-by="configStore.tableBehavior.MyData.sortBy"
      class="ptpp-my-data-table table-stripe table-header-no-wrap"
      hover
      @update:itemsPerPage="(v) => configStore.updateTableBehavior('MyData', 'itemsPerPage', v)"
      @update:sortBy="(v) => configStore.updateTableBehavior('MyData', 'sortBy', v)"
    >
      <!-- 站点信息 -->
      <template #item.siteUserConfig.sortIndex="{ item }">
        <div class="d-flex flex-column align-center">
          <v-badge
            :model-value="configStore.myDataTableControl.showUnreadMessage && (item.messageCount ?? 0) > 0"
            :content="(item.messageCount ?? 0) > 10 ? undefined : item.messageCount"
            color="error"
          >
            <div class="favicon-hover-wrapper favicon-hover-bg">
              <SiteFavicon
                :site-id="item.site"
                :size="configStore.myDataTableControl.showSiteName ? 18 : 24"
                @click="() => flushSiteLastUserInfo([item.site])"
              />
            </div>
          </v-badge>

          <SiteName v-if="configStore.myDataTableControl.showSiteName" :site-id="item.site" />
        </div>
      </template>

      <!-- 用户名，用户ID -->
      <template #item.name="{ item }">
        <span :title="item.id as string" class="text-no-wrap">
          {{ configStore.myDataTableControl.showUserName ? (item.name ?? "-") : "******" }}
        </span>
      </template>

      <!-- 等级信息，升级信息 -->
      <template #item.levelName="{ item }">
        <UserLevelRequirementsTd :user-info="item" />
      </template>

      <!-- 上传、下载 -->
      <template #item.uploaded="{ item }">
        <v-container>
          <v-row class="flex-nowrap" justify="end">
            <span class="text-no-wrap">
              {{ typeof item.uploaded !== "undefined" ? formatSize(item.uploaded) : "-" }}
            </span>
            <v-icon color="green-darken-4" icon="mdi-chevron-up" size="small"></v-icon>
          </v-row>
          <v-row class="flex-nowrap" justify="end">
            <span class="text-no-wrap">
              {{ typeof item.downloaded !== "undefined" ? formatSize(item.downloaded) : "-" }}
            </span>
            <v-icon color="red-darken-4" icon="mdi-chevron-down" size="small"></v-icon>
          </v-row>
        </v-container>
      </template>

      <!-- 真实上传、下载 -->
      <template #item.trueUploaded="{ item }">
        <v-container>
          <v-row class="flex-nowrap" justify="end">
            <span class="text-no-wrap">
              {{ typeof item.trueUploaded !== "undefined" ? formatSize(item.trueUploaded) : "-" }}
            </span>
            <v-icon color="green-darken-4" icon="mdi-chevron-up" size="small"></v-icon>
          </v-row>
          <v-row class="flex-nowrap" justify="end">
            <span class="text-no-wrap">
              {{ typeof item.trueDownloaded !== "undefined" ? formatSize(item.trueDownloaded) : "-" }}
            </span>
            <v-icon color="red-darken-4" icon="mdi-chevron-down" size="small"></v-icon>
          </v-row>
        </v-container>
      </template>

      <!-- 分享率 -->
      <template #item.ratio="{ item }">
        <span class="text-no-wrap">{{ formatRatio(item) }}</span>
      </template>

      <!-- 真实分享率 -->
      <template #item.trueRatio="{ item }">
        <span class="text-no-wrap">{{ formatRatio(item, "trueRatio") }}</span>
      </template>

      <!-- 发布数 -->
      <template #item.uploads="{ item }">
        <span class="text-no-wrap">{{ item.uploads ?? "-" }}</span>
      </template>

      <!-- 做种数， H&R 情况  -->
      <template #item.seeding="{ item }">
        <v-container class="py-0">
          <v-row align="center" class="flex-nowrap my-0" justify="end">
            <span class="text-no-wrap">{{ item.seeding ?? "-" }}</span>
          </v-row>
          <v-row v-if="configStore.myDataTableControl.showHnR" align="center" class="flex-nowrap my-0" justify="end">
            <span
              v-if="typeof item.hnrPreWarning !== 'undefined' && item.hnrPreWarning > 0"
              class="d-inline-flex align-center ml-2"
            >
              <v-icon
                :title="t('levelRequirement.hnrPreWarning')"
                color="yellow-darken-4"
                icon="mdi-alert"
                size="small"
              />
              <span class="text-no-wrap">
                {{ item.hnrPreWarning }}
              </span>
            </span>
            <span
              v-if="typeof item.hnrUnsatisfied !== 'undefined' && item.hnrUnsatisfied > 0"
              class="d-inline-flex align-center ml-1"
            >
              <v-icon
                :title="t('levelRequirement.hnrUnsatisfied')"
                color="red-darken-4"
                icon="mdi-alert-circle"
                size="small"
              />
              <span class="text-no-wrap">
                {{ item.hnrUnsatisfied }}
              </span>
            </span>
          </v-row>
        </v-container>
      </template>

      <!-- 做种量 -->
      <template #item.seedingSize="{ item }">
        <span class="text-no-wrap">
          {{ typeof item.seedingSize !== "undefined" ? formatSize(item.seedingSize) : "-" }}
        </span>
      </template>

      <!-- 魔力/积分 -->
      <template #item.bonus="{ item }">
        <v-container>
          <v-row align="center" class="flex-nowrap" justify="end">
            <v-icon :title="t('levelRequirement.bonus')" color="green-darken-4" icon="mdi-currency-usd" size="small" />
            <BonusFormatSpan :num="item.bonus" />
          </v-row>
          <v-row
            v-if="
              configStore.myDataTableControl.showSeedingBonus &&
              item.seedingBonus !== '' &&
              !isUndefined(item.seedingBonus)
            "
            align="center"
            class="flex-nowrap"
            justify="end"
          >
            <v-icon
              :title="t('levelRequirement.seedingBonus')"
              color="green-darken-4"
              icon="mdi-lightning-bolt-circle"
              size="small"
            />
            <BonusFormatSpan :num="item.seedingBonus" />
          </v-row>
        </v-container>
      </template>

      <template #item.bonusPerHour="{ item }">
        <BonusFormatSpan :num="item.bonusPerHour" />
      </template>

      <template #item.invites="{ item }">
        <span class="text-no-wrap">{{ typeof item.invites !== "undefined" ? item.invites : "-" }}</span>
      </template>

      <!-- 入站时间 -->
      <template #item.joinTime="{ item }">
        <span class="text-no-wrap" :title="item.joinTime ? (formatDate(item.joinTime) as string) : '-'">
          {{
            typeof item.joinTime !== "undefined"
              ? configStore.myDataTableControl.joinTimeFormat === "aliveWeek"
                ? formatTimeAgo(item.joinTime, { weekOnly: true })
                : configStore.myDataTableControl.joinTimeFormat === "alive"
                  ? formatTimeAgo(item.joinTime)
                  : formatDate(item.joinTime, "yyyy-MM-dd")
              : "-"
          }}
        </span>
      </template>

      <!-- 最近访问时间 -->
      <template #item.lastAccessAt="{ item }">
        <span class="text-no-wrap" :title="item.lastAccessAt ? (formatDate(item.lastAccessAt) as string) : '-'">
          <template v-if="typeof item.lastAccessAt !== 'undefined'">
            {{ formatDate(item.lastAccessAt) }}
            <v-icon
              v-if="item.lastAccessDuration >= 5"
              icon="mdi-alert"
              :color="item.lastAccessDuration >= 15 ? 'red' : 'amber'"
              :title="t('MyData.table.lastAccessDurationNote', [item.lastAccessDuration])"
            />
          </template>
          <template v-else>-</template>
        </span>
      </template>

      <!-- 更新时间 -->
      <template #item.updateAt="{ item }">
        <template v-if="item.status === EResultParseStatus.success">
          <v-btn
            :to="{ name: 'UserDataStatistic', query: { sites: [item.site] } }"
            size="small"
            variant="tonal"
            :title="item.updateAt ? (formatDate(item.updateAt) as string) : '-'"
          >
            {{
              item.updateAt
                ? configStore.myDataTableControl.updateAtFormatAsAlive
                  ? formatTimeAgo(item.updateAt)
                  : formatDate(item.updateAt)
                : "-"
            }}
          </v-btn>
        </template>
      </template>

      <template #item.status="{ item }">
        <ResultParseStatus v-if="item.status !== EResultParseStatus.success" :status="item.status" />
      </template>
    </v-data-table>
  </v-card>
</template>

<style scoped lang="scss">
.ptpp-section-title {
  margin-bottom: 8px;
}

.ptpp-my-data-card {
  overflow: hidden;
}

.ptpp-my-data-toolbar {
  padding: 18px 16px;
}

.ptpp-my-data-table {
  width: 100%;
}

.ptpp-my-data-table:deep(.v-data-table__th),
.ptpp-my-data-table:deep(.v-data-table__td) {
  padding-inline: 8px !important;
  font-size: 0.8125rem;
}

.ptpp-my-data-table:deep(tbody .v-data-table__tr) {
  height: 56px;
}

.favicon-hover-wrapper {
  cursor: pointer;
}

.favicon-hover-bg {
  border-radius: 50%;
  transition: background 0.2s;
  display: inline-flex;
  padding: 4px;
}

.favicon-hover-bg:hover {
  background: rgba(0, 0, 0, 0.3);
}
</style>
