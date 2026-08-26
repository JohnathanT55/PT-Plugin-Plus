<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { buildInPtGenApi, type IMovieEntityCacheStats } from "@ptd/social";

import { sendMessage } from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import SettingsSection from "./SettingsSection.vue";

import { useI18n } from "vue-i18n";

const { t } = useI18n();
const configStore = useConfigStore();
const clearing = ref(false);
const showClearDialog = ref(false);
const cacheStats = ref<IMovieEntityCacheStats>({ count: 0, approximateBytes: 0 });

const movieCache = computed(() => configStore.socialSiteInformation.movieEntityCache!);

function formatCacheSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

async function refreshCacheStats() {
  cacheStats.value = await sendMessage("getMovieEntityCacheStats", undefined);
}

async function clearMovieCache() {
  clearing.value = true;
  try {
    await Promise.all([
      sendMessage("clearMovieEntityCache", undefined),
      sendMessage("clearSocialInformationCache", undefined),
    ]);
    await refreshCacheStats();
    showClearDialog.value = false;
  } finally {
    clearing.value = false;
  }
}

onMounted(refreshCacheStats);
</script>

<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('socialConfig.movieCardTitle')"
      :description="t('socialConfig.movieCardDescription')"
      icon="mdi-movie-open-outline"
    >
      <v-alert class="mb-4" density="compact" type="info" variant="tonal">
        {{ t("socialConfig.moviePrivacyNotice") }}
      </v-alert>

      <v-switch
        v-model="movieCache.enabled"
        :label="t('socialConfig.movieCacheEnabled')"
        color="success"
        hide-details
      />

      <div class="settings-grid mt-4">
        <v-number-input
          v-model="movieCache.metadataDays"
          :label="t('socialConfig.movieMetadataDays')"
          :max="365"
          :min="1"
          controlVariant="default"
          hide-details
        />
        <v-number-input
          v-model="movieCache.ratingHours"
          :label="t('socialConfig.movieRatingHours')"
          :max="720"
          :min="1"
          controlVariant="default"
          hide-details
        />
        <v-number-input
          v-model="movieCache.retentionDays"
          :label="t('socialConfig.movieRetentionDays')"
          :max="365"
          :min="1"
          controlVariant="default"
          hide-details
        />
        <v-number-input
          v-model="movieCache.maxEntries"
          :label="t('socialConfig.movieCacheMaxEntries')"
          :max="2000"
          :min="20"
          controlVariant="default"
          hide-details
        />
      </div>

      <div class="cache-actions mt-4">
        <div class="text-body-2 text-medium-emphasis">
          {{
            t("socialConfig.movieCacheStats", {
              count: cacheStats.count,
              size: formatCacheSize(cacheStats.approximateBytes),
            })
          }}
        </div>
        <v-btn color="error" prepend-icon="mdi-delete-sweep-outline" variant="tonal" @click="showClearDialog = true">
          {{ t("socialConfig.clearMovieCache") }}
        </v-btn>
      </div>
    </SettingsSection>

    <SettingsSection
      :title="t('socialConfig.providerTitle')"
      :description="t('socialConfig.providerDescription')"
      icon="mdi-source-branch"
    >
      <v-switch
        v-model="configStore.socialSiteInformation.preferPtGen"
        :label="t('socialConfig.preferPtgenLabel')"
        color="success"
        hide-details
      />
      <v-combobox
        v-if="configStore.socialSiteInformation.preferPtGen"
        v-model="configStore.socialSiteInformation.ptGenEndpoint"
        :items="buildInPtGenApi"
        :return-object="false"
        class="mt-3"
        item-title="provider"
        item-value="url"
        :label="t('socialConfig.ptgenApiAddress')"
        :messages="t('socialConfig.ptgenApiMessages')"
      />

      <v-number-input
        v-model="configStore.socialSiteInformation.timeout"
        :label="t('socialConfig.requestTimeoutMs')"
        :max="30000"
        :min="1000"
        class="mt-3"
        controlVariant="default"
        hide-details
      />
    </SettingsSection>

    <SettingsSection
      :title="t('socialConfig.optionalProviderTitle')"
      :description="t('socialConfig.optionalProviderDescription')"
      icon="mdi-key-variant"
    >
      <v-text-field
        v-model="configStore.socialSiteInformation.socialSite!.tmdb.apikey"
        autocomplete="off"
        clearable
        :label="t('socialConfig.tmdbCredential')"
        :messages="t('socialConfig.tmdbCredentialMessage')"
        type="password"
      />
      <v-text-field
        v-model="configStore.socialSiteInformation.socialSite!.omdb.apikey"
        autocomplete="off"
        clearable
        :label="t('socialConfig.omdbApiKey')"
        :messages="t('socialConfig.omdbApiKeyMessage')"
        type="password"
      />
    </SettingsSection>

    <SettingsSection :title="t('socialConfig.otherProviderTitle')" icon="mdi-database-outline">
      <v-text-field
        v-model="configStore.socialSiteInformation.socialSite!.anidb.client"
        :label="t('socialConfig.anidbClientId')"
        clearable
        :messages="t('socialConfig.anidbClientMessages')"
      >
        <template #prepend>
          <v-avatar image="/icons/social/anidb.png" />
        </template>
      </v-text-field>

      <v-text-field
        v-model="configStore.socialSiteInformation.socialSite!.bangumi.apikey"
        :label="t('socialConfig.bangumiApiKey')"
        clearable
        :messages="t('socialConfig.bangumiApiMessages')"
      >
        <template #prepend>
          <v-avatar image="/icons/social/bangumi.png" />
        </template>
      </v-text-field>
    </SettingsSection>
  </div>

  <v-dialog v-model="showClearDialog" max-width="480">
    <v-card>
      <v-card-title>{{ t("socialConfig.clearMovieCache") }}</v-card-title>
      <v-card-text>{{ t("socialConfig.clearMovieCacheConfirm") }}</v-card-text>
      <v-card-actions class="justify-end">
        <v-btn :disabled="clearing" variant="text" @click="showClearDialog = false">{{ t("common.cancel") }}</v-btn>
        <v-btn :loading="clearing" color="error" variant="elevated" @click="clearMovieCache">
          {{ t("common.confirm") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.settings-stack {
  max-width: 1100px;
}

.settings-grid {
  display: grid;
  gap: 14px;
  grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
}

.cache-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
  justify-content: space-between;
}

@media (max-width: 800px) {
  .settings-grid {
    grid-template-columns: 1fr;
  }
}
</style>
