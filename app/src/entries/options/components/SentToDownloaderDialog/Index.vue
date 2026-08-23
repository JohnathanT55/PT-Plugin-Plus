<script setup lang="ts">
import { ref, computed, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toMerged } from "es-toolkit";

import { type ITorrent } from "@ptd/site";
import {
  type CAddTorrentOptions,
  getDownloaderIcon as getDownloaderIconRaw,
  getDownloaderMetaData,
} from "@ptd/downloader";

import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import type { IDownloaderMetadata } from "@/shared/types.ts";
import {
  buildSiteDownloadMenuTargets,
  hasSiteDownloadDirectoryBinding,
  type DownloadMenuTarget,
} from "@/shared/downloadTarget.ts";

import { sendTorrentToDownloader } from "./utils.ts";

const showDialog = defineModel<boolean>();
const { torrentItems, allowedDownloaderIds } = defineProps<{
  torrentItems: ITorrent[];
  allowedDownloaderIds?: string[];
}>();
const emit = defineEmits<{
  (e: "cancel"): void;
  (e: "done"): void;
}>();

const { t } = useI18n();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const isSending = ref(false);
const quickSendToClient = ref<boolean>(false);
const selectedDownloader = ref<IDownloaderMetadata | null>(null);
const selectedDownloaderMetadata = shallowRef();
const addTorrentOptions = ref<Required<Omit<CAddTorrentOptions, "localDownloadOption">>>({
  localDownload: true,
  addAtPaused: false,
  savePath: "",
  label: "",
  uploadSpeedLimit: 0,
  advanceAddTorrentOptions: {},
});

const currentSiteIds = computed(() => [...new Set(torrentItems.map((t) => t.site).filter(Boolean))]);
const allowedDownloaderIdSet = computed(() =>
  allowedDownloaderIds === undefined ? undefined : new Set(allowedDownloaderIds),
);
const isAllowedDownloader = (downloader: IDownloaderMetadata) =>
  allowedDownloaderIdSet.value === undefined || allowedDownloaderIdSet.value.has(downloader.id);
const currentSiteId = computed(() => (currentSiteIds.value.length === 1 ? currentSiteIds.value[0] : undefined));
const currentSiteProfile = computed(() =>
  currentSiteId.value ? metadataStore.siteDownloadProfiles?.[currentSiteId.value] : undefined,
);
const selectedSiteTarget = computed(() =>
  selectedDownloader.value?.id ? currentSiteProfile.value?.byDownloader?.[selectedDownloader.value.id] : undefined,
);
const uniqueStrings = (values: Array<string | undefined>) => [
  ...new Set(values.map((value) => value?.trim()).filter(Boolean) as string[]),
];
const suggestFolders = computed(() =>
  uniqueStrings([
    selectedSiteTarget.value?.defaultDirectory,
    ...(selectedSiteTarget.value?.directories ?? []),
    ...(selectedDownloader.value?.suggestFolders ?? []),
  ]),
);
const suggestTags = computed(() =>
  uniqueStrings([
    selectedSiteTarget.value?.defaultTag,
    ...(selectedSiteTarget.value?.tags ?? []),
    ...(selectedDownloader.value?.suggestTags ?? []),
  ]),
);
const enabledDownloadersBySite = computed(() => {
  const ids = currentSiteIds.value;
  const enabledDownloaders = metadataStore.getEnabledDownloaders.filter(isAllowedDownloader);
  if (ids.length === 0) return enabledDownloaders;
  const sets = ids.map((id) => new Set(metadataStore.getEnabledDownloadersBySite(id).map((d) => d.id)));
  const intersection = sets.reduce((acc, s) => new Set([...acc].filter((x) => s.has(x))));
  return enabledDownloaders.filter((d) => intersection.has(d.id));
});
const sortedEnabledDownloadersBySite = computed(() =>
  [...enabledDownloadersBySite.value].sort((a, b) => {
    const aBound = hasSiteDownloadDirectoryBinding(currentSiteProfile.value?.byDownloader?.[a.id]) ? 1 : 0;
    const bBound = hasSiteDownloadDirectoryBinding(currentSiteProfile.value?.byDownloader?.[b.id]) ? 1 : 0;
    return bBound - aBound || (b.sortIndex ?? 0) - (a.sortIndex ?? 0);
  }),
);
const quickTargets = computed(() =>
  buildSiteDownloadMenuTargets(metadataStore, currentSiteId.value).filter(
    (target) => allowedDownloaderIdSet.value === undefined || allowedDownloaderIdSet.value.has(target.downloaderId),
  ),
);
const firstGeneralTargetIndex = computed(() => quickTargets.value.findIndex((target) => target.kind === "general"));
const downloaderTitle = (downloader: IDownloaderMetadata) => `${downloader.name} [${downloader.address}]`;
const getDownloaderIcon = (x: string) => chrome.runtime.getURL(getDownloaderIconRaw(x));

function restoreAddTorrentOptions(downloader?: IDownloaderMetadata) {
  addTorrentOptions.value.localDownload = true;
  addTorrentOptions.value.addAtPaused = !(downloader?.feature?.DefaultAutoStart ?? true);
  addTorrentOptions.value.savePath = "";
  addTorrentOptions.value.label = "";
  addTorrentOptions.value.advanceAddTorrentOptions = downloader?.advanceAddTorrentOptions ?? {};
  const siteTarget = downloader?.id ? currentSiteProfile.value?.byDownloader?.[downloader.id] : undefined;
  if (hasSiteDownloadDirectoryBinding(siteTarget)) {
    addTorrentOptions.value.savePath = siteTarget.defaultDirectory || siteTarget.directories[0] || "";
    addTorrentOptions.value.label = siteTarget.defaultTag || (siteTarget.tags.length === 1 ? siteTarget.tags[0] : "");
    addTorrentOptions.value.addAtPaused = !(siteTarget.autoStart ?? downloader?.feature?.DefaultAutoStart ?? true);
  }
}

watch(selectedDownloader, (value) => {
  if (value?.type) {
    getDownloaderMetaData(value.type).then((v) => (selectedDownloaderMetadata.value = v));
  } else {
    selectedDownloaderMetadata.value = null;
  }
});

async function sendToDownloader() {
  if (!selectedDownloader.value?.id) {
    runtimeStore.showSnakebar(t("SentToDownloaderDialog.selectDownloaderFirst"), { color: "error" });
    return;
  }

  if (configStore.download.saveLastDownloader) {
    // noinspection ES6MissingAwait
    metadataStore.setLastDownloader({
      id: selectedDownloader.value.id,
      options: addTorrentOptions.value,
    });
  }

  isSending.value = true;

  sendTorrentToDownloader(torrentItems, selectedDownloader.value.id, addTorrentOptions.value).finally(() => {
    isSending.value = false;
    showDialog.value = false;
    emit("done");
  });
}

function quickSendToDownloader(target: DownloadMenuTarget) {
  selectedDownloader.value = target.downloader;

  // 设置下载推送选项
  addTorrentOptions.value.localDownload = true;
  addTorrentOptions.value.addAtPaused = !target.autoStart;
  addTorrentOptions.value.advanceAddTorrentOptions = target.downloader.advanceAddTorrentOptions ?? {};
  addTorrentOptions.value.savePath = target.savePath;
  addTorrentOptions.value.label = target.label;

  return sendToDownloader();
}

async function dialogEnter() {
  restoreAddTorrentOptions(); // 先重置所有选项，然后如果需要则从uiStore中获取历史情况
  quickSendToClient.value = configStore.download.useQuickSendToClient;

  // 如果不是快速发送到客户端模式，则尝试设置默认下载器
  if (!quickSendToClient.value) {
    const lastDownloaderId = metadataStore.lastDownloader?.id;
    const siteDownloaderId = currentSiteProfile.value?.defaultDownloaderId;
    const siteDownloader = siteDownloaderId
      ? sortedEnabledDownloadersBySite.value.find(
          (downloader) =>
            downloader.id === siteDownloaderId &&
            hasSiteDownloadDirectoryBinding(currentSiteProfile.value?.byDownloader?.[downloader.id]),
        )
      : undefined;
    const lastDownloader = lastDownloaderId
      ? sortedEnabledDownloadersBySite.value.find((downloader) => downloader.id === lastDownloaderId)
      : undefined;
    selectedDownloader.value = siteDownloader
      ? siteDownloader
      : lastDownloader // 如果有上次选择且仍允许使用的下载器，则直接使用
        ? lastDownloader
        : sortedEnabledDownloadersBySite.value.length === 1 // 如果只有一个启用的下载器，则直接使用
          ? sortedEnabledDownloadersBySite.value[0]
          : null;

    restoreAddTorrentOptions(selectedDownloader.value ?? undefined);

    // 将上一次的下载器选项通过 toMerged 合并到当前选项中，而不是直接覆盖
    if (!siteDownloader) {
      addTorrentOptions.value = toMerged(
        addTorrentOptions.value,
        metadataStore.lastDownloader?.options ?? {},
      ) as Required<Omit<CAddTorrentOptions, "localDownloadOption">>;
    }
  }
}

function dialogLeave() {
  restoreAddTorrentOptions(); // 先重置所有选项，然后从uiStore中获取历史情况
  emit("cancel");
}
</script>

<template>
  <v-dialog
    v-model="showDialog"
    :persistent="isSending"
    max-width="800"
    scrollable
    @after-enter="dialogEnter"
    @after-leave="dialogLeave"
  >
    <v-card>
      <v-card-title class="pa-0">
        <v-toolbar color="blue-grey-darken-2">
          <v-toolbar-title>{{ t("SentToDownloaderDialog.title", [torrentItems.length]) }}</v-toolbar-title>
          <template #append>
            <v-btn icon="mdi-close" :title="t('common.dialog.close')" @click="showDialog = false" />
          </template>
        </v-toolbar>
      </v-card-title>

      <v-card-text>
        <v-alert v-if="isSending" type="info" variant="tonal">
          {{
            t("SentToDownloaderDialog.isSending", {
              name: selectedDownloader?.name,
              address: selectedDownloader?.address,
            })
          }}
        </v-alert>

        <v-form v-else>
          <!-- 快速下载选项 -->
          <v-container v-if="quickSendToClient" class="pa-0">
            <v-list v-if="quickTargets.length > 0">
              <template
                v-for="(target, index) in quickTargets"
                :key="`${target.kind}-${target.downloaderId}-${target.savePath}-${target.label}`"
              >
                <v-divider v-if="index === firstGeneralTargetIndex && firstGeneralTargetIndex > 0" class="my-2" />
                <v-list-item
                  :prepend-avatar="getDownloaderIcon(target.downloader.type)"
                  :subtitle="
                    [target.downloader.address, target.savePath, target.label ? `#${target.label}` : '']
                      .filter(Boolean)
                      .join(' → ')
                  "
                  :title="target.downloader.name"
                  @click.stop="() => quickSendToDownloader(target)"
                >
                  <template #append>
                    <v-chip v-if="target.kind === 'site'" color="primary" label size="small">站点专用</v-chip>
                  </template>
                </v-list-item>
              </template>
            </v-list>
            <v-alert v-else type="warning" variant="tonal">
              {{
                currentSiteIds.length > 0 && configStore.download.allowDownloaderFilterForSite
                  ? t("SentToDownloaderDialog.noDownloaderForSite")
                  : t("SentToDownloaderDialog.noDownloader")
              }}
            </v-alert>
          </v-container>

          <!-- 普通下载选项 -->
          <v-container v-else class="pb-0">
            <v-row>
              <v-autocomplete
                v-model="selectedDownloader"
                :filter-keys="['raw.name', 'raw.address', 'raw.username']"
                :items="sortedEnabledDownloadersBySite"
                clearable
                :placeholder="t('SentToDownloaderDialog.selectDownloader')"
                @update:model-value="restoreAddTorrentOptions"
              >
                <template #selection="{ item: { raw: downloader } }">
                  <v-list-item
                    :prepend-avatar="getDownloaderIcon(downloader.type)"
                    :title="downloaderTitle(downloader)"
                  />
                </template>
                <template #item="{ props, item: { raw: downloader } }">
                  <v-list-item
                    v-bind="props"
                    :prepend-avatar="getDownloaderIcon(downloader.type)"
                    :title="downloaderTitle(downloader)"
                  >
                    <template #append>
                      <v-chip color="indigo" label>{{ downloader.type }}</v-chip>
                    </template>
                  </v-list-item>
                </template>
              </v-autocomplete>
            </v-row>
            <v-row>
              <v-col class="py-0 pl-0" cols="6">
                <v-combobox
                  v-model="addTorrentOptions.savePath"
                  :items="suggestFolders"
                  :hint="t('SentToDownloaderDialog.savePathHint')"
                  :label="t('SentToDownloaderDialog.savePath')"
                  persistent-hint
                >
                </v-combobox>
              </v-col>
              <v-col class="py-0 pr-0" cols="6">
                <v-combobox
                  v-model="addTorrentOptions.label"
                  :items="suggestTags"
                  :hint="t('SentToDownloaderDialog.labelHint')"
                  :label="t('SentToDownloaderDialog.label')"
                  persistent-hint
                ></v-combobox>
              </v-col>
            </v-row>

            <v-row>
              <v-col>
                <!-- FIXME 添加设置项，默认 disabled -->
                <v-switch
                  v-model="addTorrentOptions.localDownload"
                  color="success"
                  :disabled="!configStore.download.allowDirectSendToClient"
                  hide-details
                  :label="t('SentToDownloaderDialog.localRelay')"
                />
              </v-col>
              <v-col>
                <v-switch
                  v-model="addTorrentOptions.addAtPaused"
                  color="success"
                  hide-details
                  :label="t('SentToDownloaderDialog.pauseOnAdd')"
                />
              </v-col>
            </v-row>
            <v-row>
              <v-col class="pa-0">
                <v-expansion-panels
                  :disabled="!((selectedDownloaderMetadata?.advanceAddTorrentOptions ?? []).length > 0)"
                >
                  <v-expansion-panel :title="t('common.advancedSettings')">
                    <v-expansion-panel-text>
                      <v-switch
                        v-for="opt in selectedDownloaderMetadata.advanceAddTorrentOptions"
                        :key="opt.key"
                        v-model="addTorrentOptions.advanceAddTorrentOptions![opt.key]"
                        color="success"
                        :label="opt.name"
                        :messages="opt.description"
                        :hide-details="!opt.description"
                      />
                    </v-expansion-panel-text>
                  </v-expansion-panel>
                </v-expansion-panels>
              </v-col>
            </v-row>
          </v-container>
        </v-form>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-btn
          :title="t('SentToDownloaderDialog.moreOptions')"
          icon="mdi-cards"
          @click="quickSendToClient = !quickSendToClient"
        />

        <v-spacer />
        <v-btn
          :disabled="isSending"
          color="info"
          prepend-icon="mdi-close-circle"
          variant="text"
          @click="showDialog = false"
        >
          <span class="ml-1">{{ t("common.dialog.cancel") }}</span>
        </v-btn>
        <v-btn
          :disabled="!selectedDownloader || quickSendToClient"
          :loading="isSending"
          color="error"
          variant="text"
          @click="sendToDownloader"
        >
          <v-icon icon="mdi-check-circle-outline" />
          <span class="ml-1">{{ t("common.dialog.ok") }}</span>
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss"></style>
