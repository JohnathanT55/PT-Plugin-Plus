<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { isEmpty } from "es-toolkit/compat";

import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();

async function clearLastFilter(v: boolean) {
  if (!v) {
    await metadataStore.setLastSearchFilter("");
  }
}

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
  <div class="settings-stack">
    <SettingsSection :title="t('SetBase.searchEntity.siteSearchConfig')" icon="mdi-magnify-scan">
      <v-number-input
        v-model="configStore.searchEntity.queueConcurrency"
        :label="t('SetBase.searchEntity.siteQueueConcurrency')"
        :max="25"
        :min="1"
        controlVariant="default"
        hide-details
      />
    </SettingsSection>

    <SettingsSection :title="t('SetBase.searchEntity.searchPlanLabel')" icon="mdi-tune-vertical">
      <v-switch
        v-model="configStore.searchEntity.allowSingleSiteSearch"
        :disabled="isEmpty(metadataStore.sites)"
        :label="t('SetBase.searchEntity.allowSingleSiteSearch')"
        color="success"
        hide-details
      />

      <v-switch
        v-model="configStore.searchEntity.treatTTQueryAsImdbSearch"
        :label="t('SetBase.searchEntity.treatTTQueryAsImdbSearch')"
        color="success"
        hide-details
      >
        <template #append>
          <v-tooltip location="bottom" max-width="400">
            <template v-slot:activator="{ props }">
              <v-icon color="info" icon="mdi-help-circle" v-bind="props" />
            </template>
            {{ t("SetBase.searchEntity.imdbTip") }}
          </v-tooltip>
        </template>
      </v-switch>

      <v-switch
        v-model="configStore.searchEntity.showHotRecommendations"
        :label="t('SetBase.searchEntity.showHotRecommendations')"
        color="success"
        hide-details
      />
    </SettingsSection>

    <SettingsSection
      :title="t('SetBase.searchEntity.movieSuggestionLabel')"
      :description="t('SetBase.searchEntity.movieSuggestionDescription')"
      icon="mdi-movie-search-outline"
    >
      <v-switch
        v-model="configStore.searchEntity.movieSuggestionEnabled"
        :label="t('SetBase.searchEntity.movieSuggestionEnabled')"
        color="success"
        hide-details
      />

      <v-switch
        v-model="configStore.searchEntity.movieInfoCardEnabled"
        :label="t('SetBase.searchEntity.movieInfoCardEnabled')"
        color="success"
        hide-details
      />

      <template v-if="configStore.searchEntity.movieSuggestionEnabled">
        <v-number-input
          v-model="configStore.searchEntity.movieSuggestionCount"
          :label="t('SetBase.searchEntity.movieSuggestionCount')"
          :max="10"
          :min="1"
          controlVariant="default"
          hide-details
        />

        <v-select
          v-model="configStore.searchEntity.movieSuggestionSearchMode"
          :items="[
            { title: t('SetBase.searchEntity.movieSuggestionSearchById'), value: 'id' },
            { title: t('SetBase.searchEntity.movieSuggestionSearchByTitle'), value: 'title' },
          ]"
          :label="t('SetBase.searchEntity.movieSuggestionSearchMode')"
          class="mt-3"
          hide-details
        />
      </template>
    </SettingsSection>

    <SettingsSection :title="t('SetBase.searchEntity.filterLabel')" icon="mdi-filter-cog-outline">
      <v-switch
        v-model="configStore.searchEntity.saveLastFilter"
        :label="t('SetBase.searchEntity.saveLastSearchFilter')"
        color="success"
        hide-details
        @update:model-value="(v) => clearLastFilter(v as boolean)"
      />

      <v-switch
        v-model="configStore.searchEntity.forceImdbIdMatchFilter"
        :label="t('SetBase.searchEntity.forceImdbIdMatchFilter')"
        color="success"
        hide-details
      />

      <v-switch
        v-model="configStore.searchEntity.quickSiteFilter"
        :label="t('SetBase.searchEntity.quickSiteFilter')"
        color="success"
        hide-details
      />
    </SettingsSection>

    <SettingsSection :title="t('SetBase.searchEntity.tagLabel')" icon="mdi-tag-multiple-outline">
      <v-switch
        v-model="configStore.searchEntity.autoDetectOfficialGroupFromTitle"
        :label="t('SetBase.searchEntity.autoDetectOfficialGroupFromTitle')"
        color="success"
        hide-details
      />

      <v-number-input
        v-model="configStore.searchEntifyControl.maxTagCountBeforeGroup"
        :label="t('SetBase.searchEntity.maxTagCountBeforeGroup')"
        :min="0"
        :max="50"
        controlVariant="default"
        hide-details
      />

      <v-textarea
        v-model="hiddenTagNamesText"
        :label="t('SetBase.searchEntity.hiddenTagNames')"
        :messages="t('SetBase.searchEntity.hiddenTagNamesMessage')"
        class="mt-2"
        auto-grow
        clearable
        rows="5"
      />
    </SettingsSection>
  </div>
</template>

<style scoped lang="scss">
.settings-stack {
  max-width: 1100px;
}
</style>
