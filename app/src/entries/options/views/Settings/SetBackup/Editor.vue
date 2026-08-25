<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { getBackupServer, getBackupServerMetaData, IBackupMetadata } from "@ptd/backupServer";

import { BackupFields, type IBackupServerMetadata } from "@/shared/types.ts";
import { formValidateRules } from "@/options/utils.ts";

import ConnectCheckButton from "@/options/components/ConnectCheckButton.vue";
import { normalizeBackupRetentionPolicy } from "@foundation/backup/retention";

const { t } = useI18n();

const clientConfig = defineModel<IBackupServerMetadata>();
const emits = defineEmits<{
  (e: "update:configValid", value: boolean): void;
}>();

const clientMeta = computedAsync<IBackupMetadata<any>>(
  async () => {
    const clientType = clientConfig.value?.type;
    if (!clientType) {
      return { requiredField: [] } as IBackupMetadata<any>;
    }
    return await getBackupServerMetaData(clientType);
  },
  { requiredField: [] } as IBackupMetadata<any>,
);

const formValid = ref<boolean>(false);

async function checkConnect() {
  const clientType = clientConfig.value?.type;
  if (formValid.value && clientConfig.value && clientType) {
    const client = await getBackupServer(clientConfig.value);
    return await client.ping();
  }
  return false;
}

function resolveMetaText(value?: string) {
  return value?.startsWith("i18n.") ? t(value.slice(5)) : value;
}

watchEffect(() => {
  if (clientConfig.value && !clientConfig.value.retentionPolicy) {
    clientConfig.value.retentionPolicy = normalizeBackupRetentionPolicy(undefined);
  }
});
</script>

<template>
  <v-form v-if="clientConfig" v-model="formValid" fast-fail>
    <v-card class="mb-4" variant="outlined">
      <v-card-title class="text-subtitle-1">{{ t("common.basicInfo") }}</v-card-title>
      <v-divider />
      <v-card-text>
        <v-row>
          <v-col cols="12" md="4">
            <v-text-field v-model="clientConfig.type" :label="t('common.type')" disabled hide-details />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="clientConfig.name"
              :label="t('SetDownloader.common.name')"
              :placeholder="t('SetDownloader.common.name')"
              :rules="[formValidateRules.require(t('SetDownloader.editor.nameTip'))]"
              hide-details
              required
            />
          </v-col>
          <v-col cols="12" md="4">
            <v-text-field
              v-model="clientConfig.id"
              :label="t('SetDownloader.common.uid') + t('SetDownloader.editor.uidPlaceholder')"
              disabled
              hide-details
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-card class="mb-4" variant="outlined">
      <v-card-title class="text-subtitle-1">{{ t("SetBackup.Editor.serverConfig") }}</v-card-title>
      <v-divider />
      <v-card-text>
        <v-row no-gutters>
          <v-col v-for="metaField in clientMeta.requiredField" :key="metaField.key" class="my-1" cols="12">
            <v-textarea
              v-if="metaField.type === 'strings'"
              v-model="clientConfig.config[metaField.key! as string]"
              :hide-details="false"
              :label="resolveMetaText(metaField.name)"
              :messages="resolveMetaText(metaField.description)"
            />
            <v-text-field
              v-else-if="metaField.type === 'string'"
              v-model="clientConfig.config[metaField.key! as string]"
              :hide-details="false"
              :label="resolveMetaText(metaField.name)"
              :messages="resolveMetaText(metaField.description)"
            />
            <v-switch
              v-else-if="metaField.type === 'boolean'"
              v-model="clientConfig.config[metaField.key! as string]"
              :hide-details="false"
              :label="resolveMetaText(metaField.name)"
              :messages="resolveMetaText(metaField.description)"
              color="success"
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-card class="mb-4" variant="outlined">
      <v-card-title class="text-subtitle-1">{{ t("SetBackup.Editor.backupConfig") }}</v-card-title>
      <v-divider />
      <v-card-text>
        <v-row no-gutters>
          <v-col cols="12">
            <v-text-field
              v-model.number="clientConfig.backupInterval"
              :label="t('SetBackup.Editor.backupInterval')"
              :messages="t('SetBackup.Editor.backupIntervalHint')"
              :min="0"
              :max="48"
              clearable
              hide-details="auto"
              suffix="h"
              type="number"
            />
          </v-col>
        </v-row>

        <v-row no-gutters>
          <v-col v-for="backupField in BackupFields" :key="backupField" cols="12" md="4">
            <v-switch
              v-model="clientConfig.backupFields"
              :label="t(`SetBackup.fields.${backupField}`)"
              :value="backupField"
              color="success"
              hide-details
            />
          </v-col>
        </v-row>
      </v-card-text>
    </v-card>

    <v-card v-if="clientConfig.retentionPolicy" class="mb-4" variant="outlined">
      <v-card-title class="text-subtitle-1">{{ t("SetBackup.Editor.retentionTitle") }}</v-card-title>
      <v-divider />
      <v-card-text>
        <v-switch
          v-model="clientConfig.retentionPolicy.enabled"
          :label="t('SetBackup.Editor.retentionEnabled')"
          :messages="t('SetBackup.Editor.retentionSafetyHint')"
          color="success"
          hide-details="auto"
        />

        <template v-if="clientConfig.retentionPolicy.enabled">
          <v-radio-group v-model="clientConfig.retentionPolicy.strategy" class="mt-3" hide-details>
            <v-radio :label="t('SetBackup.Editor.strategyAge')" value="age" />
            <v-radio :label="t('SetBackup.Editor.strategyCount')" value="count" />
          </v-radio-group>

          <v-row class="mt-1">
            <v-col v-if="clientConfig.retentionPolicy.strategy === 'age'" cols="12" md="6">
              <v-text-field
                v-model.number="clientConfig.retentionPolicy.maxAgeDays"
                :label="t('SetBackup.Editor.maxAgeDays')"
                :min="1"
                :max="36500"
                suffix="d"
                type="number"
              />
            </v-col>
            <v-col v-else cols="12" md="6">
              <v-text-field
                v-model.number="clientConfig.retentionPolicy.keepLatest"
                :label="t('SetBackup.Editor.keepLatest')"
                :min="1"
                :max="10000"
                type="number"
              />
            </v-col>
            <v-col cols="12" md="6">
              <v-text-field
                v-model.number="clientConfig.retentionPolicy.minKeep"
                :label="t('SetBackup.Editor.minKeep')"
                :min="1"
                :max="10000"
                :messages="t('SetBackup.Editor.minKeepHint')"
                type="number"
              />
            </v-col>
          </v-row>

          <v-divider class="my-2" />
          <v-switch
            v-model="clientConfig.retentionPolicy.tiered.enabled"
            :label="t('SetBackup.Editor.tieredEnabled')"
            :messages="t('SetBackup.Editor.tieredHint')"
            color="success"
            hide-details="auto"
          />
          <v-row v-if="clientConfig.retentionPolicy.tiered.enabled" class="mt-1">
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="clientConfig.retentionPolicy.tiered.recentCount"
                :label="t('SetBackup.Editor.tierRecent')"
                :min="0"
                type="number"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="clientConfig.retentionPolicy.tiered.weeklyCount"
                :label="t('SetBackup.Editor.tierWeekly')"
                :min="0"
                type="number"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.number="clientConfig.retentionPolicy.tiered.monthlyCount"
                :label="t('SetBackup.Editor.tierMonthly')"
                :min="0"
                type="number"
              />
            </v-col>
            <v-col cols="12">
              <v-text-field
                v-model="clientConfig.retentionPolicy.tiered.timeZone"
                :label="t('SetBackup.Editor.tierTimeZone')"
                :messages="t('SetBackup.Editor.tierTimeZoneHint')"
                placeholder="UTC"
              />
            </v-col>
          </v-row>
        </template>
      </v-card-text>
    </v-card>

    <ConnectCheckButton
      :check-fn="checkConnect"
      :reset-timeout="3e3"
      @after:check-connect="
        () => emits('update:configValid', formValid && true) // 不管是否测试成功，都允许用户进行下一步操作（保存下载服务器配置）
      "
    />
  </v-form>
</template>

<style scoped lang="scss"></style>
