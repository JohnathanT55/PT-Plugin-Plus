<script setup lang="ts">
import { computed, watch } from "vue";
import { useI18n } from "vue-i18n";

import type { ISiteDownloadProfile, ISiteDownloadTarget } from "@/shared/types.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { getDownloaderIcon } from "@ptd/downloader";

const profile = defineModel<ISiteDownloadProfile>({ required: true });
const metadataStore = useMetadataStore();
const { t } = useI18n();

const enabledDownloaders = computed(() => metadataStore.getSortedEnabledDownloadersBySite(profile.value.siteId));

function emptyTarget(): ISiteDownloadTarget {
  return { directories: [], tags: [] };
}

function syncTargets() {
  profile.value.byDownloader ??= {};
  for (const downloader of enabledDownloaders.value) {
    profile.value.byDownloader[downloader.id] ??= emptyTarget();
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function folderItems(downloaderId: string): string[] {
  return unique([
    ...(metadataStore.downloaders[downloaderId]?.suggestFolders ?? []),
    ...(profile.value.byDownloader[downloaderId]?.directories ?? []),
  ]);
}

function tagItems(downloaderId: string): string[] {
  return unique([
    ...(metadataStore.downloaders[downloaderId]?.suggestTags ?? []),
    ...(profile.value.byDownloader[downloaderId]?.tags ?? []),
  ]);
}

function normalizeTarget(downloaderId: string) {
  const target = profile.value.byDownloader[downloaderId];
  target.directories = unique(target.directories);
  target.tags = unique(target.tags);
  if (target.defaultDirectory && !target.directories.includes(target.defaultDirectory)) {
    target.directories.unshift(target.defaultDirectory);
  }
  if (target.defaultTag && !target.tags.includes(target.defaultTag)) {
    target.tags.unshift(target.defaultTag);
  }
}

watch(() => enabledDownloaders.value.map((downloader) => downloader.id), syncTargets, { immediate: true });
</script>

<template>
  <v-card class="mb-5 pa-1">
    <v-container>
      <v-label class="mb-2">{{ t("SetSite.downloadProfile.title") }}</v-label>
      <v-alert class="mb-4" type="info" variant="tonal">
        {{ t("SetSite.downloadProfile.description") }}
      </v-alert>

      <v-autocomplete
        v-model="profile.defaultDownloaderId"
        :items="enabledDownloaders"
        :label="t('SetSite.downloadProfile.defaultDownloader')"
        clearable
        item-title="name"
        item-value="id"
      >
        <template #selection="{ item: { raw: downloader } }">
          <v-list-item
            :prepend-avatar="getDownloaderIcon(downloader.type)"
            :subtitle="downloader.address"
            :title="downloader.name"
          />
        </template>
        <template #item="{ props, item: { raw: downloader } }">
          <v-list-item
            v-bind="props"
            :prepend-avatar="getDownloaderIcon(downloader.type)"
            :subtitle="downloader.address"
            :title="downloader.name"
          />
        </template>
      </v-autocomplete>

      <v-expansion-panels multiple variant="accordion">
        <v-expansion-panel v-for="downloader in enabledDownloaders" :key="downloader.id">
          <v-expansion-panel-title>
            <v-avatar class="mr-3" size="24">
              <v-img :src="getDownloaderIcon(downloader.type)" />
            </v-avatar>
            {{ downloader.name }} · {{ downloader.address }}
            <v-chip v-if="profile.defaultDownloaderId === downloader.id" class="ml-3" color="primary" size="small">
              {{ t("SetSite.downloadProfile.siteDefault") }}
            </v-chip>
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <v-combobox
              v-model="profile.byDownloader[downloader.id].directories"
              :items="folderItems(downloader.id)"
              :label="t('SetSite.downloadProfile.directories')"
              chips
              clearable
              multiple
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-combobox
              v-model="profile.byDownloader[downloader.id].defaultDirectory"
              :items="folderItems(downloader.id)"
              :label="t('SetSite.downloadProfile.defaultDirectory')"
              clearable
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-combobox
              v-model="profile.byDownloader[downloader.id].tags"
              :items="tagItems(downloader.id)"
              :label="t('SetSite.downloadProfile.tags')"
              chips
              clearable
              multiple
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-combobox
              v-model="profile.byDownloader[downloader.id].defaultTag"
              :items="tagItems(downloader.id)"
              :label="t('SetSite.downloadProfile.defaultTag')"
              clearable
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-switch
              v-model="profile.byDownloader[downloader.id].autoStart"
              :label="t('SetSite.downloadProfile.autoStart')"
              color="success"
              hide-details
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <v-alert v-if="enabledDownloaders.length === 0" type="warning" variant="tonal">
        {{ t("SetSite.downloadProfile.noDownloader") }}
      </v-alert>
    </v-container>
  </v-card>
</template>
