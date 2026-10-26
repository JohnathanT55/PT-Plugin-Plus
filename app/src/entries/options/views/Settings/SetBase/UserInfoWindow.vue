<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { range } from "es-toolkit";

import { EJobType } from "@/background/utils/alarms.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate } from "@/options/utils.ts";
import { sendMessage } from "@/messages.ts";
import { useI18n } from "vue-i18n";
import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const backupServerItems = computed(() =>
  metadataStore.getBackupServers.map((server) => ({ title: server.name, value: server.id })),
);

const nextFlushUserInfoAt = ref<number>(0);
const signInSiteItems = ref<Array<{ id: string; name: string; supported: boolean; generic: boolean }>>([]);
const signInBusy = reactive(new Set<string>());

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
  // Site-level sign-in switches live in the metadata store rather than the
  // global config store. Persist them together with the settings tab so the
  // background/offscreen signer sees the same values after a reload.
  await metadataStore.$save();

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

async function loadSignInSites() {
  signInSiteItems.value = await Promise.all(
    metadataStore.getAddedSiteIds.map(async (id) => {
      const site = await metadataStore.getSiteMetadata(id);
      return {
        id,
        name: await metadataStore.getSiteName(id),
        supported: Boolean(site.signIn?.enabled),
        generic: site.signIn?.source === "generic",
      };
    }),
  );
}

async function runSiteSignIn(siteId: string) {
  if (signInBusy.has(siteId)) return;
  signInBusy.add(siteId);
  try {
    const result = await sendMessage("runSiteSignIn", siteId);
    metadataStore.siteSignIns[siteId] = result;
    const color = result.status === "success" || result.status === "alreadySigned" ? "success" : "warning";
    runtimeStore.showSnakebar(result.error ?? result.status, { color });
  } catch {
    metadataStore.siteSignIns[siteId] = {
      status: "failed",
      lastAttemptAt: Date.now(),
      error: t("SetBase.userInfo.siteSignInStatuses.failed"),
    };
    runtimeStore.showSnakebar(t("SetBase.userInfo.siteSignInStatuses.failed"), { color: "warning" });
  } finally {
    signInBusy.delete(siteId);
  }
}

async function openSite(siteId: string) {
  const url = await metadataStore.getSiteUrl(siteId);
  if (/^https?:\/\//i.test(url)) await sendMessage("openSiteTabs", [url]);
}

function signInStatusLabel(status: string | undefined) {
  return status ? t(`SetBase.userInfo.siteSignInStatuses.${status}`) : t("SetBase.userInfo.siteSignInNever");
}

defineExpose({
  beforeSave,
  afterSave: save,
});

onMounted(async () => {
  // noinspection ES6MissingAwait
  getNextFlushUserInfoAt();
  await loadSignInSites();
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

    <SettingsSection :title="t('SetBase.userInfo.siteSignIn')" icon="mdi-calendar-check-outline">
      <v-alert class="mb-3" density="compact" type="info" variant="tonal">
        {{ t("SetBase.userInfo.siteSignInHint") }}
      </v-alert>
      <v-switch
        v-model="configStore.signIn.enabled"
        :label="t('SetBase.userInfo.siteSignInEnabled')"
        color="success"
        hide-details
      />
      <v-switch
        v-if="configStore.signIn.enabled"
        v-model="configStore.signIn.paused"
        :label="t('SetBase.userInfo.siteSignInPaused')"
        color="warning"
        hide-details
      />
      <v-number-input
        v-if="configStore.signIn.enabled"
        v-model="configStore.signIn.intervalHours"
        :label="t('SetBase.userInfo.siteSignInInterval')"
        :min="6"
        :max="168"
        hint="6–168"
        persistent-hint
      />
      <v-list v-if="signInSiteItems.length > 0" class="mt-2" lines="two">
        <v-list-item v-for="item in signInSiteItems" :key="item.id" :title="item.name">
          <template #prepend>
            <v-switch
              v-model="metadataStore.sites[item.id].signInEnabled"
              class="mr-3"
              color="success"
              density="compact"
              :disabled="!item.supported"
              hide-details
              :aria-label="item.name"
            />
          </template>
          <template #subtitle>
            {{
              !item.supported
                ? t("SetBase.userInfo.siteSignInManualOnly")
                : item.generic
                  ? t("SetBase.userInfo.siteSignInGeneric")
                  : t("SetBase.userInfo.siteSignInSupported")
            }}
          </template>
          <template #append>
            <v-chip
              v-if="metadataStore.siteSignIns[item.id]?.status"
              class="mr-2"
              :color="
                metadataStore.siteSignIns[item.id]?.status === 'success' ||
                metadataStore.siteSignIns[item.id]?.status === 'alreadySigned'
                  ? 'success'
                  : 'warning'
              "
              size="small"
              variant="tonal"
              :title="metadataStore.siteSignIns[item.id]?.error ?? ''"
            >
              {{ signInStatusLabel(metadataStore.siteSignIns[item.id]?.status) }}
            </v-chip>
            <v-btn
              v-if="item.supported"
              :disabled="!metadataStore.sites[item.id].signInEnabled || signInBusy.has(item.id)"
              icon="mdi-calendar-check"
              :loading="signInBusy.has(item.id)"
              size="small"
              variant="text"
              :title="t('SetBase.userInfo.siteSignInNow')"
              @click="runSiteSignIn(item.id)"
            />
            <v-btn
              icon="mdi-open-in-new"
              size="small"
              variant="text"
              :title="t('SetBase.userInfo.siteSignInOpenSite')"
              @click="openSite(item.id)"
            />
          </template>
        </v-list-item>
      </v-list>
      <v-alert v-else density="compact" type="warning" variant="tonal">
        {{ t("SetBase.userInfo.siteSignInNoSites") }}
      </v-alert>
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
