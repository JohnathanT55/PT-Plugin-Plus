<script setup lang="ts">
import { useI18n } from "vue-i18n";

import { supportTheme } from "@/shared/types.ts";
import { definedLangMetaData } from "@/options/plugins/i18n.ts";

import { useConfigStore } from "@/options/stores/config.ts";
import SettingsSection from "./SettingsSection.vue";
import UiScaleControl from "@/options/components/UiScaleControl.vue";

const { t } = useI18n();
const configStore = useConfigStore();
</script>

<template>
  <div class="settings-stack">
    <SettingsSection :title="t('SetBase.section.appearance')" icon="mdi-palette-outline">
      <!-- 插件语言设置 -->
      <v-select v-model="configStore.lang" :label="t('SetBase.ui.changeLanguage')" :items="definedLangMetaData" />

      <!-- 明亮模式设置 -->
      <v-select v-model="configStore.theme" :label="t('SetBase.ui.displayMode.index')" :items="supportTheme">
        <template #selection="{ item }">
          {{ t("SetBase.ui.displayMode." + item.raw) }}
        </template>

        <template #item="{ item, props }">
          <v-list-item v-bind="props" :title="t('SetBase.ui.displayMode.' + item.raw)" />
        </template>
      </v-select>

      <div class="ptpp-ui-scale-setting">
        <div>
          <div class="text-body-1">{{ t("SetBase.ui.uiScale") }}</div>
          <div class="text-caption text-medium-emphasis">{{ t("SetBase.ui.uiScaleHint") }}</div>
        </div>
        <UiScaleControl />
      </div>

      <v-switch
        v-model="configStore.showReleaseNoteOnVersionChange"
        color="success"
        hide-details
        :label="t('SetBase.ui.showReleaseNote')"
      />

      <v-switch
        v-model="configStore.saveTableBehavior"
        color="success"
        hide-details
        :label="t('SetBase.ui.saveTableBehavior')"
      />

      <v-switch
        v-model="configStore.enableTableMultiSort"
        color="success"
        hide-details
        :label="t('SetBase.ui.enableTableMultiSort')"
      >
        <template #append>
          <v-tooltip max-width="400" location="bottom">
            <template v-slot:activator="{ props }">
              <v-icon color="info" icon="mdi-help-circle" v-bind="props" />
            </template>
            {{ t("SetBase.ui.tableMultiSortNote") }}
          </v-tooltip>
        </template>
      </v-switch>
    </SettingsSection>
  </div>
</template>

<style scoped lang="scss">
.settings-stack {
  max-width: 1100px;
}

.ptpp-ui-scale-setting {
  align-items: center;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: flex;
  justify-content: space-between;
  min-height: 64px;
  padding-inline: 16px 8px;
}
</style>
