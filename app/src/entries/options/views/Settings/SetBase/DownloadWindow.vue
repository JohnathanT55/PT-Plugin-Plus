<script setup lang="ts">
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import { DownloadSizeUnits, LocalDownloadMethod } from "@/shared/types.ts";
import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
</script>

<template>
  <div class="settings-stack">
    <SettingsSection :title="t('SetBase.download.pushDownloadServerTitle')" icon="mdi-download-network-outline">
      <v-switch
        v-model="configStore.download.saveDownloadHistory"
        :label="t('SetBase.download.saveDownloadHistory')"
        color="success"
        false-icon="mdi-alert-octagon"
        hide-details
      />
      <v-text-field
        v-model.number="configStore.download.batchDownloadInterval"
        :label="t('SetBase.download.batchDownloadInterval')"
        min="0"
        suffix="s"
        type="number"
      />
      <v-switch
        v-model="configStore.download.enableBackgroundDownload"
        :label="t('SetBase.download.enableBackgroundDownload')"
        color="success"
        hide-details
      />
      <v-switch
        v-model="configStore.download.downloadFailedRetry"
        :label="t('SetBase.download.downloadFailedRetry')"
        color="success"
        hide-details
      />
      <v-row v-if="configStore.download.downloadFailedRetry" class="pl-10">
        <v-col cols="5">
          <v-select
            v-model.number="configStore.download.downloadFailedFailedRetryCount"
            :items="[1, 2, 3, 4, 5]"
            :label="t('SetBase.download.downloadFailedRetryCount')"
          />
        </v-col>
        <v-col cols="7">
          <v-text-field
            v-model.number="configStore.download.downloadFailedFailedRetryInterval"
            :label="t('SetBase.download.downloadFailedRetryInterval')"
            min="0"
            suffix="s"
            type="number"
          />
        </v-col>
      </v-row>
      <v-switch
        v-model="configStore.download.needConfirmWhenExceedSize"
        :label="t('SetBase.download.needConfirmWhenExceedSize')"
        color="success"
        hide-details
      />
      <v-row v-if="configStore.download.needConfirmWhenExceedSize" class="pl-10">
        <v-col cols="7">
          <v-text-field
            v-model.number="configStore.download.exceedSize"
            :label="t('SetBase.download.exceedSize')"
            min="0"
            type="number"
          />
        </v-col>
        <v-col cols="5">
          <v-select
            v-model="configStore.download.exceedSizeUnit"
            :items="DownloadSizeUnits"
            :label="t('SetBase.download.exceedSizeUnit')"
          />
        </v-col>
      </v-row>
    </SettingsSection>

    <SettingsSection :title="t('SetBase.download.localDownloadTitle')" icon="mdi-download-box-outline">
      <v-select
        v-model="configStore.download.localDownloadMethod"
        :label="t('SetBase.download.localDownloadMethod')"
        :items="
          LocalDownloadMethod.map((item) => ({
            title: t(`SetBase.download.localDownloadMethodOptions.${item}`),
            value: item,
          }))
        "
        :hint="t(`SetBase.download.localDownloadMethodOptions.${configStore.download.localDownloadMethod}Tip`)"
        persistent-hint
      />
      <v-switch
        v-model="configStore.download.ignoreSiteDownloadIntervalWhenLocalDownload"
        color="success"
        hide-details
        :label="t('SetBase.download.localDownloadIgnoreInterval')"
      />
    </SettingsSection>
  </div>
</template>

<style scoped lang="scss">
.settings-stack {
  max-width: 1100px;
}
</style>
