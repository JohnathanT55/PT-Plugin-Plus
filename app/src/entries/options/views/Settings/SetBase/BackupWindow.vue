<script setup lang="ts">
import { nanoid } from "nanoid";
import { ref, shallowRef, watch } from "vue";
import { useThrottledRefHistory } from "@vueuse/core";
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";

const { t } = useI18n();
const configStore = useConfigStore();

const showEncryptionKey = ref<boolean>(false);
const encryptionKey = shallowRef<string>(configStore.backup.encryptionKey);
const { history, undo: undoEncryptionKey } = useThrottledRefHistory(encryptionKey, { throttle: 50 });
watch(encryptionKey, (newValue) => {
  configStore.backup.encryptionKey = newValue; // 将 encryptionKey 同步回 configStore
});

function randomEncryptionKey() {
  encryptionKey.value = nanoid();
}
</script>

<template>
  <v-row>
    <v-col md="10" lg="8">
      <v-label class="my-2">{{ t("ptppSettings.basicConfig") }}</v-label>
      <v-alert class="mb-2" type="info" variant="tonal">
        {{ t("ptppSettings.saveKeyNotice") }}
      </v-alert>
      <v-text-field
        v-model="encryptionKey"
        :append-inner-icon="showEncryptionKey ? 'mdi-eye' : 'mdi-eye-off'"
        :label="t('ptppSettings.encryptionKeyLabel')"
        :type="showEncryptionKey ? 'text' : 'password'"
        hide-details
        @click:append-inner="showEncryptionKey = !showEncryptionKey"
      >
        <template #append>
          <v-btn
            :disabled="history.length <= 1"
            color="green"
            variant="text"
            icon
            :title="t('ptppSettings.undoKeyTitle')"
            @click="undoEncryptionKey"
          >
            <v-badge v-if="history.length > 1" :content="history.length - 1" :max="9" floating>
              <v-icon color="green" icon="mdi-arrow-left" />
            </v-badge>
            <v-icon v-else icon="mdi-arrow-left" />
          </v-btn>
          <v-btn
            color="warning"
            icon="mdi-key"
            variant="text"
            :title="t('ptppSettings.randomGenTitle')"
            @click="randomEncryptionKey"
          />
        </template>
      </v-text-field>
    </v-col>
  </v-row>

  <v-row>
    <v-col md="10" lg="8">
      <v-label class="my-2">{{ t("ptppSettings.importConfigTitle") }}</v-label>
      <v-alert class="mb-2" type="info" variant="tonal">
        {{ t("ptppSettings.unifiedImportNotice") }}
        <template #append>
          <v-btn :to="{ name: 'SetBackup' }" color="primary" prepend-icon="mdi-backup-restore" variant="outlined">
            {{ t("SetBackup.RestoreDialog.title") }}
          </v-btn>
        </template>
      </v-alert>
    </v-col>
  </v-row>
</template>

<style scoped lang="scss"></style>
