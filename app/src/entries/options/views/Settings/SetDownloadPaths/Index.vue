<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { cloneDeep } from "es-toolkit";
import { useI18n } from "vue-i18n";
import type { DataTableHeader } from "vuetify";

import type { ISiteDownloadTarget } from "@/shared/types.ts";
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
    .filter((site) => site.target || site.isDefault);
});

const headers = computed(
  () =>
    [
      { title: t("common.site"), key: "site", align: "start" },
      { title: t("SetSite.downloadProfile.directories"), key: "directories", align: "start", sortable: false },
      { title: t("SetSite.downloadProfile.tags"), key: "tags", align: "start", sortable: false },
      { title: t("common.action"), key: "action", align: "center", sortable: false },
    ] as DataTableHeader[],
);

const showEditor = ref(false);
const editingSiteId = ref("");
const target = ref<ISiteDownloadTarget>({ directories: [], tags: [] });
const useAsSiteDefault = ref(false);

const siteItems = computed(() =>
  (allAddedSiteInfo.value ?? []).map((site) => ({
    id: site.id,
    title: site.userConfig.merge?.name ?? site.metadata.name,
  })),
);

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
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
  if (useAsSiteDefault.value) profile.defaultDownloaderId = selectedDownloaderId.value;
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
    <v-card-title class="d-flex align-center ga-3">
      <v-select
        v-model="selectedDownloaderId"
        :items="downloaders"
        class="ptpp-downloader-select"
        density="compact"
        hide-details
        item-title="name"
        item-value="id"
        :label="t('SetSite.downloadProfile.defaultDownloader')"
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

    <v-data-table :headers="headers" :items="rows" item-value="id" class="table-stripe table-header-no-wrap">
      <template #item.site="{ item }">
        <div class="d-flex align-center ga-2">
          <SiteFavicon :site-id="item.id" />
          <SiteName :site-id="item.id" />
          <v-chip v-if="item.isDefault" color="primary" size="x-small">
            {{ t("common.default") }}
          </v-chip>
        </div>
      </template>
      <template #item.directories="{ item }">
        <v-chip
          v-for="directory in item.target?.directories ?? []"
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
          v-for="tag in item.target?.tags ?? []"
          :key="tag"
          :color="tag === item.target?.defaultTag ? 'primary' : undefined"
          class="ma-1"
          size="small"
        >
          {{ tag }}
        </v-chip>
      </template>
      <template #item.action="{ item }">
        <v-btn icon="mdi-pencil" size="small" variant="text" :title="t('common.edit')" @click="openEditor(item.id)" />
        <v-btn
          color="error"
          icon="mdi-delete"
          size="small"
          variant="text"
          :title="t('common.remove')"
          @click="removeTarget(item.id)"
        />
      </template>
    </v-data-table>
  </v-card>

  <v-dialog v-model="showEditor" max-width="760" scrollable>
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
        <v-switch v-model="useAsSiteDefault" color="success" :label="t('SetSite.downloadProfile.siteDefault')" />
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

<style scoped>
.ptpp-downloader-select {
  max-width: 480px;
}
</style>
