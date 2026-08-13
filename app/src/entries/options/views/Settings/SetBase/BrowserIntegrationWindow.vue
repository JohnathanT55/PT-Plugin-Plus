<script setup lang="ts">
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();
</script>

<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('SetBase.integration.contextMenuTitle')"
      :description="t('SetBase.integration.contextMenuDescription')"
      icon="mdi-menu-open"
    >
      <div class="d-flex align-center">
        <v-spacer />
        <v-switch v-model="configStore.contextMenus.enabled" color="success" hide-details :label="t('common.enable')" />
      </div>

      <template v-if="configStore.contextMenus.enabled">
        <v-switch
          v-model="configStore.contextMenus.allowSelectionTextSearch"
          color="success"
          hide-details
          :label="t('SetBase.ui.contextMenuTextSearch')"
        />

        <v-switch
          v-model="configStore.contextMenus.allowSocialLinkSearch"
          color="success"
          hide-details
          :label="t('SetBase.ui.contextMenuSocialSearch')"
        />

        <v-switch
          v-model="configStore.contextMenus.allowLinkDownloadPush"
          :disabled="metadataStore.getEnabledDownloaders.length === 0"
          color="success"
          hide-details
          :label="t('SetBase.ui.contextMenuLinkPush')"
        />
      </template>
    </SettingsSection>
  </div>
</template>

<style scoped>
.settings-stack {
  max-width: 1100px;
}
</style>
