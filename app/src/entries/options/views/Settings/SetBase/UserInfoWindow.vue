<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { range } from "es-toolkit";

import { EJobType } from "@/background/utils/alarms.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { formatDate } from "@/options/utils.ts";
import { sendMessage } from "@/messages.ts";
import { useI18n } from "vue-i18n";
import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();

const backupServerItems = computed(() =>
  metadataStore.getBackupServers.map((server) => ({ title: server.name, value: server.id })),
);

const nextFlushUserInfoAt = ref<number>(0);

async function getNextFlushUserInfoAt() {
  const alarm = await chrome.alarms.get(EJobType.FlushUserInfo);
  if (alarm) {
    nextFlushUserInfoAt.value = alarm.scheduledTime;
  }
}

async function save() {
  if (configStore.userInfo.autoReflush.enabled) {
    // noinspection ES6MissingAwait
    getNextFlushUserInfoAt();
  } else {
    nextFlushUserInfoAt.value = 0;
  }
}

async function beforeSave() {
  const autoUpload = configStore.backup.autoUploadUserData;
  if (autoUpload.enabled && !metadataStore.backupServers[autoUpload.serverId]) {
    autoUpload.serverId = backupServerItems.value[0]?.value ?? "";
    if (!autoUpload.serverId) autoUpload.enabled = false;
  }
  for (const server of metadataStore.getBackupServers) {
    if (
      server.lastBackupTrigger === "userDataRefresh" &&
      server.backupRetryAt &&
      (!autoUpload.enabled || autoUpload.serverId !== server.id)
    ) {
      await sendMessage("cancelBackupRetry", server.id).catch(() => false);
    }
  }
}

defineExpose({
  beforeSave,
  afterSave: save,
});

onMounted(async () => {
  // noinspection ES6MissingAwait
  getNextFlushUserInfoAt();
});
</script>

<template>
  <div class="settings-stack">
    <SettingsSection :title="t('SetBase.userInfo.userDataRefresh')" icon="mdi-database-refresh-outline">
      <v-number-input
        v-model="configStore.userInfo.queueConcurrency"
        :max="25"
        :min="1"
        :label="t('userInfo.queueConcurrency')"
      ></v-number-input>

      <v-switch
        v-model="configStore.userInfo.alwaysPickLastUserInfo"
        :label="t('userInfo.alwaysPickLastUserInfo')"
        color="success"
        hide-details
      />

      <!-- 自动刷新 -->
      <v-switch
        v-model="configStore.userInfo.autoReflush.enabled"
        :label="t('userInfo.enableAutoRefresh')"
        color="success"
        hide-details
      />
      <v-row v-if="configStore.userInfo.autoReflush.enabled" class="mt-1 ml-2 mb-2">
        <v-alert type="info" variant="outlined">
          <div class="d-flex flex-wrap align-center ga-2 mb-2">
            • {{ t("SetBase.userInfo.afterTime") }}
            <v-text-field
              :model-value="configStore.userInfo.autoReflush.afterTime"
              :aria-label="t('SetBase.userInfo.afterTime')"
              class="refresh-control"
              density="compact"
              hide-details
              max-width="130"
              readonly
            >
              <v-menu :close-on-content-click="false" activator="parent" min-width="0">
                <v-time-picker v-model="configStore.userInfo.autoReflush.afterTime" format="24hr"></v-time-picker>
              </v-menu>
            </v-text-field>
            后，{{ t("userInfo.autoRefresh.every") }}
            <v-select
              v-model="configStore.userInfo.autoReflush.interval"
              :aria-label="t('userInfo.autoRefresh.interval')"
              :items="range(1, 24)"
              :max="23"
              :min="1"
              class="refresh-control"
              density="compact"
              hide-details
              max-width="100"
            />
            {{ t("userInfo.autoRefresh.hoursLabel") }}
            <span class="font-weight-bold">{{ t("userInfo.autoRefresh.unrefreshedSite") }}</span>
            {{ t("userInfo.autoRefresh.ofSites") }}
          </div>
          <div class="d-flex flex-wrap align-center ga-2">
            • {{ t("userInfo.autoRefresh.retryOnFail") }}
            <v-select
              v-model="configStore.userInfo.autoReflush.retry.max"
              :aria-label="t('userInfo.autoRefresh.retryTimes')"
              :items="range(0, 6)"
              class="refresh-control"
              density="compact"
              hide-details
              max-width="100"
            />
            {{ t("userInfo.autoRefresh.times") }}
            <v-select
              v-model="configStore.userInfo.autoReflush.retry.interval"
              :aria-label="t('userInfo.autoRefresh.retryInterval')"
              :items="range(1, 11)"
              class="refresh-control"
              density="compact"
              hide-details
              max-width="100"
            />
            {{ t("userInfo.autoRefresh.minutes") }}
          </div>
          <div class="d-flex align-center justify-end mt-1">
            {{ t("userInfo.autoRefresh.lastFlushTime") }} {{ formatDate(metadataStore.lastUserInfoAutoFlushAt) }} &nbsp;
            {{ t("userInfo.autoRefresh.nextFlushTime") }}
            {{ nextFlushUserInfoAt != 0 ? formatDate(nextFlushUserInfoAt) : "-" }}
            <v-btn
              :title="t('userInfo.autoRefresh.getNextFlushTime')"
              class="ml-1"
              density="compact"
              icon="mdi-refresh"
              size="x-small"
              variant="text"
              @click="getNextFlushUserInfoAt"
            ></v-btn>
          </div>
        </v-alert>
      </v-row>

      <v-switch
        v-model="configStore.backup.autoUploadUserData.enabled"
        :disabled="!configStore.userInfo.autoReflush.enabled || backupServerItems.length === 0"
        :label="t('userInfo.autoUpload.enabled')"
        color="success"
        hide-details
      />
      <v-row
        v-if="configStore.userInfo.autoReflush.enabled && configStore.backup.autoUploadUserData.enabled"
        class="mt-1 ml-2 mb-2"
      >
        <v-alert type="info" variant="outlined">
          <div class="d-flex flex-wrap align-center ga-2">
            <span>{{ t("userInfo.autoUpload.target") }}</span>
            <v-select
              v-model="configStore.backup.autoUploadUserData.serverId"
              :aria-label="t('userInfo.autoUpload.target')"
              :items="backupServerItems"
              density="compact"
              hide-details
              max-width="420"
            />
          </div>
          <div class="text-caption mt-2">{{ t("userInfo.autoUpload.hint") }}</div>
        </v-alert>
      </v-row>
    </SettingsSection>

    <SettingsSection :title="t('SetBase.userInfo.userInfoDisplay')" icon="mdi-view-dashboard-outline">
      <v-switch
        v-model="configStore.userInfo.showDeadSiteInOverview"
        :label="t('userInfo.showDeadSite')"
        color="success"
        hide-details
      />
      <v-switch
        v-model="configStore.userInfo.showPassedSiteInOverview"
        :label="t('userInfo.showPassedSite')"
        color="success"
        hide-details
      />
    </SettingsSection>
  </div>
</template>

<style scoped lang="scss">
.settings-stack {
  max-width: 1100px;
}

.refresh-control {
  flex: 0 0 auto;
}
</style>
