<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { computedAsync } from "@vueuse/core";
import { getBackupServer, getBackupServerMetaData, IBackupMetadata } from "@ptd/backupServer";

import { BackupFields, type IBackupServerMetadata } from "@/shared/types.ts";
import { formValidateRules } from "@/options/utils.ts";

import ConnectCheckButton from "@/options/components/ConnectCheckButton.vue";

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
