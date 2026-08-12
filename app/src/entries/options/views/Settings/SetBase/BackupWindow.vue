<script setup lang="ts">
import { nanoid } from "nanoid";
import { ref, shallowRef, watch } from "vue";
import { useThrottledRefHistory } from "@vueuse/core";
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();

const showEncryptionKey = ref<boolean>(false);
const encryptionKey = shallowRef<string>(configStore.backup.encryptionKey);
const { history, undo: undoEncryptionKey } = useThrottledRefHistory(encryptionKey, { throttle: 50 });
watch(encryptionKey, (newValue) => {
  configStore.backup.encryptionKey = newValue;
  if (!newValue.trim()) configStore.backup.encryptionEnabled = false;
});

watch(
  () => configStore.backup.encryptionEnabled,
  (enabled) => {
    if (enabled && !encryptionKey.value.trim()) randomEncryptionKey();
  },
);

function randomEncryptionKey() {
  encryptionKey.value = nanoid();
}
</script>

<template>
  <div class="settings-stack">
    <SettingsSection :title="t('ptppSettings.encryptionSection')" icon="mdi-shield-key-outline">
      <v-switch
        v-model="configStore.backup.encryptionEnabled"
        :label="t('ptppSettings.encryptionEnabledLabel')"
        color="success"
        hide-details
      />
      <v-alert v-if="configStore.backup.encryptionEnabled" class="mb-2" type="warning" variant="tonal">
        {{ t("ptppSettings.saveKeyNotice") }}
      </v-alert>
      <v-text-field
        v-if="configStore.backup.encryptionEnabled"
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
      <div v-else class="text-caption text-medium-emphasis mb-2">
        {{ t("ptppSettings.encryptionDisabledHint") }}
      </div>
    </SettingsSection>

    <SettingsSection :title="t('ptppSettings.retrySection')" icon="mdi-reload-alert">
      <v-row>
        <v-col cols="12" md="6">
          <v-number-input
            v-model="configStore.backup.retry.max"
            :label="t('ptppSettings.backupRetryMax')"
            :max="10"
            :min="0"
            hide-details
          />
        </v-col>
        <v-col cols="12" md="6">
          <v-number-input
            v-model="configStore.backup.retry.interval"
            :label="t('ptppSettings.backupRetryInterval')"
            :max="120"
            :min="1"
            hide-details
            suffix="min"
          />
        </v-col>
      </v-row>
      <div class="text-caption text-medium-emphasis mt-2">{{ t("ptppSettings.backupRetryHint") }}</div>
    </SettingsSection>

    <SettingsSection :title="t('ptppSettings.importConfigTitle')" icon="mdi-backup-restore">
      <v-alert class="mb-2" type="info" variant="tonal">
        {{ t("ptppSettings.unifiedImportNotice") }}
        <template #append>
          <v-btn :to="{ name: 'SetBackup' }" color="primary" prepend-icon="mdi-backup-restore" variant="outlined">
            {{ t("SetBackup.RestoreDialog.title") }}
          </v-btn>
        </template>
      </v-alert>
    </SettingsSection>
  </div>
</template>

<style scoped lang="scss">
.settings-stack {
  max-width: 1100px;
}
</style>
