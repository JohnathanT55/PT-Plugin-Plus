<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { isEmpty } from "es-toolkit/compat";

import { toolbarDockSides } from "@/shared/types.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";

import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();

function initContentScriptExceptionSites() {
  Object.keys(metadataStore.sites).forEach((site) => {
    if (typeof metadataStore.sites[site].allowContentScript === "undefined") {
      metadataStore.sites[site].allowContentScript = true;
    }
  });
  metadataStore.$save();
}

function beforeSave() {
  if (
    configStore.contentScript.enabled &&
    configStore.contentScript.allowExceptionSites &&
    !isEmpty(metadataStore.sites)
  ) {
    initContentScriptExceptionSites();
  }
  configStore.updateContentScriptDockSide(configStore.contentScript.dockSide);
}

defineExpose({ beforeSave });
</script>

<template>
  <div class="settings-stack">
    <SettingsSection :title="t('SetBase.toolbar.availability')" icon="mdi-web-box">
      <div class="d-flex align-center">
        <v-spacer />
        <v-switch
          v-model="configStore.contentScript.enabled"
          color="success"
          hide-details
          :label="t('common.enable')"
        />
      </div>

      <template v-if="configStore.contentScript.enabled">
        <v-alert type="warning" variant="tonal">{{ t("SetBase.ui.contentScriptWarning") }}</v-alert>

        <v-switch
          v-model="configStore.contentScript.allowExceptionSites"
          color="success"
          hide-details
          :label="t('SetBase.ui.allowExceptionSites')"
        />

        <v-switch
          v-model="configStore.contentScript.enabledAtSocialSite"
          color="success"
          hide-details
          :label="t('SetBase.ui.enableOnSocialSite')"
        />
      </template>
    </SettingsSection>

    <SettingsSection :title="t('SetBase.toolbar.positionAndStyle')" icon="mdi-dock-right">
      <v-radio-group
        v-model="configStore.contentScript.dockSide"
        :disabled="!configStore.contentScript.enabled"
        inline
        :label="t('SetBase.toolbar.dockSide')"
      >
        <v-radio
          v-for="side in toolbarDockSides"
          :key="side"
          color="primary"
          :label="t(`SetBase.toolbar.dockSideOptions.${side}`)"
          :value="side"
        />
      </v-radio-group>
      <v-alert type="info" variant="tonal">{{ t("SetBase.toolbar.dockSideHint") }}</v-alert>
      <div class="text-body-2 text-medium-emphasis mt-3">{{ t("SetBase.ui.ptppToolbarStyleNote") }}</div>
    </SettingsSection>

    <SettingsSection
      v-if="configStore.contentScript.enabled"
      :title="t('SetBase.toolbar.actions')"
      icon="mdi-gesture-tap-button"
    >
      <v-switch
        v-model="configStore.contentScript.doubleConfirmAction"
        color="success"
        hide-details
        :label="t('SetBase.ui.confirmTwoStep')"
      />

      <v-switch
        v-model="configStore.contentScript.dragLinkOnSpeedDial"
        color="success"
        hide-details
        :label="t('SetBase.ui.allowDragLink')"
      >
        <template #append>
          <v-tooltip max-width="400" location="bottom">
            <template #activator="{ props }">
              <v-icon color="info" icon="mdi-help-circle" v-bind="props" />
            </template>
            {{ t("SetBase.ui.dragNote") }}
          </v-tooltip>
        </template>
      </v-switch>

      <v-select
        v-model="configStore.contentScript.socialSiteSearchBy"
        :disabled="!configStore.contentScript.enabledAtSocialSite"
        :items="['id', 'title', 'imdb', 'chosen']"
        :item-title="(item) => t('SetBase.ui.socialSiteSearchBy.' + item)"
        :item-value="(item) => item"
        :label="t('SetBase.ui.socialSiteSearchLabel')"
      />
    </SettingsSection>
  </div>
</template>

<style scoped>
.settings-stack {
  max-width: 1100px;
}
</style>
