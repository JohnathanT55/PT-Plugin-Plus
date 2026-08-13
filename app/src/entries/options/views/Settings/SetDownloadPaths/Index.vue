<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { cloneDeep } from "es-toolkit";
import { useI18n } from "vue-i18n";
import type { DataTableHeader } from "vuetify";

import type { ISiteDownloadTarget } from "@/shared/types.ts";
import { hasConfiguredSiteDownloadTarget } from "@/shared/downloadTarget.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import NavButton from "@/options/components/NavButton.vue";
import { allAddedSiteInfo } from "@/options/views/Settings/SetSite/utils.ts";
import { getDownloaderIcon } from "@ptd/downloader";

const { t } = useI18n();
const metadataStore = useMetadataStore();

const selectedDownloaderId = ref("");
const downloaders = computed(() => metadataStore.getSortedEnabledDownloaders);
watch(
  downloaders,
  (items) => {
    if (!items.some((item) => item.id === selectedDownloaderId.value)) {
      selectedDownloaderId.value = metadataStore.defaultDownloader?.id ?? items[0]?.id ?? "";
    }
  },
  { immediate: true },
);

const rows = computed(() => {
  if (!selectedDownloaderId.value) return [];
  return (allAddedSiteInfo.value ?? [])
    .map((site) => ({
      ...site,
      target: metadataStore.siteDownloadProfiles[site.id]?.byDownloader[selectedDownloaderId.value],
      isDefault: metadataStore.siteDownloadProfiles[site.id]?.defaultDownloaderId === selectedDownloaderId.value,
    }))
    // A downloader-only legacy preference is not a site binding. Keep it out
    // of this directory table unless the site really owns a directory or tag.
    .filter((site) => hasConfiguredSiteDownloadTarget(site.target));
});

const headers = computed(
  () =>
    [
      { title: t("common.site"), key: "site", align: "start", width: "28%" },
      {
        title: t("SetSite.downloadProfile.directories"),
        key: "directories",
        align: "start",
        sortable: false,
        width: "34%",
      },
      { title: t("SetSite.downloadProfile.tags"), key: "tags", align: "start", sortable: false, width: "24%" },
      { title: t("common.action"), key: "action", align: "center", sortable: false, width: "14%" },
    ] as DataTableHeader[],
);

const showEditor = ref(false);
const editingSiteId = ref("");
const target = ref<ISiteDownloadTarget>({ directories: [], tags: [] });
const useAsSiteDefault = ref(false);
const hasEditedDirectory = computed(
  () => unique([target.value.defaultDirectory ?? "", ...target.value.directories]).length > 0,
);

const siteItems = computed(() =>
  (allAddedSiteInfo.value ?? []).map((site) => ({
    id: site.id,
    title: site.userConfig.merge?.name ?? site.metadata.name,
  })),
);

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function targetDirectories(value?: ISiteDownloadTarget): string[] {
  return unique([value?.defaultDirectory ?? "", ...(value?.directories ?? [])]);
}

function targetTags(value?: ISiteDownloadTarget): string[] {
  return unique([value?.defaultTag ?? "", ...(value?.tags ?? [])]);
}

function openEditor(siteId = "") {
  editingSiteId.value = siteId;
  const profile = siteId ? metadataStore.getSiteDownloadProfile(siteId) : undefined;
  target.value = cloneDeep(profile?.byDownloader[selectedDownloaderId.value] ?? { directories: [], tags: [] });
  useAsSiteDefault.value = profile?.defaultDownloaderId === selectedDownloaderId.value;
  showEditor.value = true;
}

async function saveTarget() {
  if (!editingSiteId.value || !selectedDownloaderId.value) return;
  const profile = cloneDeep(metadataStore.getSiteDownloadProfile(editingSiteId.value));
  target.value.directories = unique(target.value.directories);
  target.value.tags = unique(target.value.tags);
  if (target.value.defaultDirectory && !target.value.directories.includes(target.value.defaultDirectory)) {
    target.value.directories.unshift(target.value.defaultDirectory);
  }
  if (target.value.defaultTag && !target.value.tags.includes(target.value.defaultTag)) {
    target.value.tags.unshift(target.value.defaultTag);
  }
  profile.byDownloader[selectedDownloaderId.value] = cloneDeep(target.value);
  if (useAsSiteDefault.value && hasEditedDirectory.value) profile.defaultDownloaderId = selectedDownloaderId.value;
  else if (profile.defaultDownloaderId === selectedDownloaderId.value) delete profile.defaultDownloaderId;
  await metadataStore.setSiteDownloadProfile(editingSiteId.value, profile);
  showEditor.value = false;
}

async function removeTarget(siteId: string) {
  const profile = cloneDeep(metadataStore.getSiteDownloadProfile(siteId));
  delete profile.byDownloader[selectedDownloaderId.value];
  if (profile.defaultDownloaderId === selectedDownloaderId.value) delete profile.defaultDownloaderId;
  await metadataStore.setSiteDownloadProfile(siteId, profile);
}
</script>

<template>
  <v-alert class="mb-2" :title="t('route.Settings.SetDownloadPaths')" type="info" />
  <v-card>
    <v-card-title class="d-flex align-center ga-3 ptpp-page-toolbar">
      <v-select
        v-model="selectedDownloaderId"
        :items="downloaders"
        class="ptpp-downloader-select"
        density="compact"
        hide-details
        item-title="name"
        item-value="id"
        :label="t('SetSite.downloadProfile.downloaderFilter')"
      >
        <template #item="{ props, item: { raw: downloader } }">
          <v-list-item
            v-bind="props"
            :prepend-avatar="getDownloaderIcon(downloader.type)"
            :subtitle="downloader.address"
            :title="downloader.name"
          />
        </template>
      </v-select>
      <v-spacer />
      <NavButton
        :disabled="!selectedDownloaderId"
        color="green"
        icon="mdi-plus"
        :text="t('common.btn.add')"
        @click="openEditor()"
      />
    </v-card-title>

    <v-data-table
      :headers="headers"
      :items="rows"
      item-value="id"
      class="ptpp-download-path-table table-stripe table-header-no-wrap"
    >
      <template #item.site="{ item }">
        <div class="ptpp-download-site">
          <span class="ptpp-download-site-icon">
            <SiteFavicon :site-id="item.id" :size="28" />
          </span>
          <SiteName :site-id="item.id" />
          <v-chip v-if="item.isDefault" color="primary" size="x-small">
            {{ t("common.default") }}
          </v-chip>
        </div>
      </template>
      <template #item.directories="{ item }">
        <v-chip
          v-for="directory in targetDirectories(item.target)"
          :key="directory"
          :color="directory === item.target?.defaultDirectory ? 'primary' : undefined"
          class="ma-1"
          size="small"
        >
          {{ directory }}
        </v-chip>
      </template>
      <template #item.tags="{ item }">
        <v-chip
          v-for="tag in targetTags(item.target)"
          :key="tag"
          :color="tag === item.target?.defaultTag ? 'primary' : undefined"
          class="ma-1"
          size="small"
        >
          {{ tag }}
        </v-chip>
      </template>
      <template #item.action="{ item }">
        <div class="ptpp-download-actions">
          <v-btn icon="mdi-pencil" size="small" variant="text" :title="t('common.edit')" @click="openEditor(item.id)" />
          <v-btn
            color="error"
            icon="mdi-delete"
            size="small"
            variant="text"
            :title="t('common.remove')"
            @click="removeTarget(item.id)"
          />
        </div>
      </template>
    </v-data-table>
  </v-card>

  <v-dialog
    v-model="showEditor"
    :aria-label="t('route.Settings.SetDownloadPaths')"
    max-width="760"
    scrollable
  >
    <v-card>
      <v-card-title>{{ t("route.Settings.SetDownloadPaths") }}</v-card-title>
      <v-card-text>
        <v-autocomplete
          v-model="editingSiteId"
          :disabled="Boolean(rows.find((row) => row.id === editingSiteId))"
          :items="siteItems"
          item-title="title"
          item-value="id"
          :label="t('common.site')"
        />
        <v-combobox
          v-model="target.directories"
          chips
          clearable
          multiple
          :label="t('SetSite.downloadProfile.directories')"
        />
        <v-combobox
          v-model="target.defaultDirectory"
          :items="target.directories"
          clearable
          :label="t('SetSite.downloadProfile.defaultDirectory')"
        />
        <v-combobox v-model="target.tags" chips clearable multiple :label="t('SetSite.downloadProfile.tags')" />
        <v-combobox
          v-model="target.defaultTag"
          :items="target.tags"
          clearable
          :label="t('SetSite.downloadProfile.defaultTag')"
        />
        <v-switch
          v-model="useAsSiteDefault"
          color="success"
          :disabled="!hasEditedDirectory"
          :hint="t('SetSite.downloadProfile.bindingRequired')"
          :label="t('SetSite.downloadProfile.siteDefault')"
          persistent-hint
        />
        <v-switch v-model="target.autoStart" color="success" :label="t('SetSite.downloadProfile.autoStart')" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn color="error" variant="text" @click="showEditor = false">{{ t("common.dialog.cancel") }}</v-btn>
        <v-btn :disabled="!editingSiteId" color="success" variant="text" @click="saveTarget">
          {{ t("common.save") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.ptpp-downloader-select {
  max-width: 480px;
}

.ptpp-download-path-table:deep(table) {
  table-layout: fixed;
}

.ptpp-download-path-table:deep(.v-data-table__td) {
  vertical-align: middle;
}

.ptpp-download-site {
  align-items: center;
  display: grid;
  gap: 10px;
  grid-template-columns: 28px minmax(0, max-content) auto;
  min-height: 42px;
}

.ptpp-download-site-icon {
  align-items: center;
  display: inline-flex;
  flex: 0 0 28px;
  height: 28px;
  justify-content: center;
  width: 28px;
}

.ptpp-download-actions {
  align-items: center;
  display: flex;
  gap: 4px;
  justify-content: center;
}
</style>
