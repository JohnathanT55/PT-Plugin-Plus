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
  const defaultDownloaderId = profile.value.defaultDownloaderId;
  if (defaultDownloaderId && !hasBoundDirectory(profile.value.byDownloader[defaultDownloaderId])) {
    delete profile.value.defaultDownloaderId;
  }
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function hasBoundDirectory(target?: ISiteDownloadTarget): boolean {
  return unique([target?.defaultDirectory ?? "", ...(target?.directories ?? [])]).length > 0;
}

const siteBindingDownloaders = computed(() =>
  enabledDownloaders.value.filter((downloader) => hasBoundDirectory(profile.value.byDownloader[downloader.id])),
);

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
  if (profile.value.defaultDownloaderId === downloaderId && !hasBoundDirectory(target)) {
    delete profile.value.defaultDownloaderId;
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
        :disabled="siteBindingDownloaders.length === 0"
        :hint="t('SetSite.downloadProfile.bindingRequired')"
        :items="siteBindingDownloaders"
        :label="t('SetSite.downloadProfile.defaultDownloader')"
        clearable
        persistent-hint
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

      <div class="ptpp-site-download-profile-list">
        <section v-for="downloader in enabledDownloaders" :key="downloader.id" class="ptpp-site-download-profile-row">
          <header class="ptpp-site-download-profile-heading">
            <v-avatar size="26">
              <v-img :src="getDownloaderIcon(downloader.type)" />
            </v-avatar>
            <div class="ptpp-site-download-profile-identity">
              <strong>{{ downloader.name }}</strong>
              <span>{{ downloader.address }}</span>
            </div>
            <v-chip v-if="profile.defaultDownloaderId === downloader.id" color="primary" size="small">
              {{ t("SetSite.downloadProfile.siteDefault") }}
            </v-chip>
          </header>

          <div class="ptpp-site-download-profile-fields">
            <v-combobox
              v-model="profile.byDownloader[downloader.id].directories"
              :items="folderItems(downloader.id)"
              :label="t('SetSite.downloadProfile.directories')"
              chips
              clearable
              density="compact"
              multiple
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-combobox
              v-model="profile.byDownloader[downloader.id].defaultDirectory"
              :items="folderItems(downloader.id)"
              :label="t('SetSite.downloadProfile.defaultDirectory')"
              clearable
              density="compact"
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-combobox
              v-model="profile.byDownloader[downloader.id].tags"
              :items="tagItems(downloader.id)"
              :label="t('SetSite.downloadProfile.tags')"
              chips
              clearable
              density="compact"
              multiple
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-combobox
              v-model="profile.byDownloader[downloader.id].defaultTag"
              :items="tagItems(downloader.id)"
              :label="t('SetSite.downloadProfile.defaultTag')"
              clearable
              density="compact"
              @update:model-value="normalizeTarget(downloader.id)"
            />
            <v-switch
              v-model="profile.byDownloader[downloader.id].autoStart"
              :label="t('SetSite.downloadProfile.autoStart')"
              color="success"
              density="compact"
              hide-details
            />
          </div>
        </section>
      </div>

      <v-alert v-if="enabledDownloaders.length === 0" type="warning" variant="tonal">
        {{ t("SetSite.downloadProfile.noDownloader") }}
      </v-alert>
    </v-container>
  </v-card>
</template>

<style scoped lang="scss">
.ptpp-site-download-profile-list {
  border: 1px solid #555;
}

.ptpp-site-download-profile-row {
  display: grid;
  grid-template-columns: minmax(210px, 0.8fr) minmax(0, 2.8fr);

  & + & {
    border-top: 1px solid #555;
  }
}

.ptpp-site-download-profile-heading {
  align-content: start;
  align-items: center;
  background: #393939;
  display: grid;
  gap: 10px;
  grid-template-columns: 26px minmax(0, 1fr);
  padding: 14px 12px;

  .v-chip {
    grid-column: 2;
    justify-self: start;
  }
}

.ptpp-site-download-profile-identity {
  display: grid;
  min-width: 0;

  strong {
    color: #eee;
  }

  span {
    color: #9bc7e4;
    font-size: 12px;
    overflow-wrap: anywhere;
  }
}

.ptpp-site-download-profile-fields {
  align-items: start;
  display: grid;
  gap: 10px 12px;
  grid-template-columns: repeat(2, minmax(180px, 1fr));
  padding: 12px;

  .v-switch {
    align-self: center;
  }
}

@media (max-width: 1100px) {
  .ptpp-site-download-profile-row {
    grid-template-columns: 1fr;
  }

  .ptpp-site-download-profile-heading .v-chip {
    grid-column: auto;
  }
}

@media (max-width: 700px) {
  .ptpp-site-download-profile-fields {
    grid-template-columns: 1fr;
  }
}
</style>
