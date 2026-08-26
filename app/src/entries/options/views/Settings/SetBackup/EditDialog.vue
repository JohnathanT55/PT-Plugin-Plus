<script setup lang="ts">
import { ref, toRaw, watch } from "vue";
import { useI18n } from "vue-i18n";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { IBackupServerMetadata, TBackupServerKey } from "@/shared/types.ts";

import Editor from "./Editor.vue";
import { CURRENT_BACKUP_FIELDS_VERSION } from "@foundation/backup/policy";
import { normalizeBackupRetentionPolicy } from "@foundation/backup/retention";

const showDialog = defineModel<boolean>();
const props = defineProps<{
  clientId: TBackupServerKey;
}>();
const clientConfig = ref<IBackupServerMetadata>();

const { t } = useI18n();
const metadataStore = useMetadataStore();

watch(
  [showDialog, () => props.clientId],
  ([visible, clientId]) => {
    const storedConfig = visible && clientId ? metadataStore.backupServers[clientId] : undefined;
    clientConfig.value = storedConfig ? structuredClone(toRaw(storedConfig)) : undefined;
  },
  { immediate: true },
);

function editClientConfig() {
  const existingInterval = metadataStore.backupServers[props.clientId]?.backupInterval;
  if (clientConfig.value && clientConfig.value.backupInterval !== existingInterval) {
    const interval = clientConfig.value.backupInterval;
    clientConfig.value.nextBackupAt =
      interval && interval > 0
        ? clientConfig.value.lastBackupAt
          ? clientConfig.value.lastBackupAt + interval * 60 * 60 * 1000
          : Date.now()
        : undefined;
    delete clientConfig.value.backupRetryAt;
    delete clientConfig.value.backupRetryCount;
  }
  if (clientConfig.value) {
    clientConfig.value.backupFieldsVersion = CURRENT_BACKUP_FIELDS_VERSION;
    clientConfig.value.retentionPolicy = normalizeBackupRetentionPolicy(clientConfig.value.retentionPolicy);
  }
  metadataStore.addBackupServer(clientConfig.value as IBackupServerMetadata);
  showDialog.value = false;
}
</script>

<template>
  <v-dialog
    v-if="showDialog"
    v-model="showDialog"
    :aria-label="t('SetBackup.EditDialog.title')"
    max-width="800"
    scrollable
  >
    <v-card>
      <v-card-title class="pa-0">
        <v-toolbar color="blue-grey-darken-2">
          <v-toolbar-title>{{ t("SetBackup.EditDialog.title") }}</v-toolbar-title>
          <template #append>
            <v-btn icon="mdi-close" :title="t('common.dialog.close')" @click="showDialog = false" />
          </template>
        </v-toolbar>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <Editor v-if="clientConfig" v-model="clientConfig" />
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-spacer />
        <v-btn color="error" prepend-icon="mdi-close-circle" variant="text" @click="showDialog = false">
          {{ t("common.dialog.cancel") }}
        </v-btn>

        <v-btn
          :disabled="!clientConfig"
          color="success"
          prepend-icon="mdi-check-circle-outline"
          variant="text"
          @click="editClientConfig"
        >
          {{ t("common.dialog.ok") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss"></style>
