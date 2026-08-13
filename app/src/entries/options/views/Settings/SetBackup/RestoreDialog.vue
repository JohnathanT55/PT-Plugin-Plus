<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { computed, ref, shallowRef } from "vue";
import { jsZipBlobToBackupData } from "@ptd/backupServer/utils.ts";
import type { IBackupData } from "@ptd/backupServer";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { sendMessage } from "@/messages.ts";
import { BackupFields, type TBackupFields, type IRestoreOptions } from "@/shared/types.ts";
import { parsePtppBackup, type IParsedPtppBackup } from "@/shared/ptppBackup.ts";

const showDialog = defineModel<boolean>();
const { t } = useI18n();

type TRestoreMetaData = { type: "file" } | { type: "remote"; server: string; path: string };

const { restoreMetadata = { type: "file" } } = defineProps<{
  restoreMetadata?: TRestoreMetaData;
}>();

const currentStep = ref<TRestoreMetaData["type"] | "restore">("file");
const decryptKey = ref<string>("");
const showDecryptKey = ref<boolean>(false);
const isDecryptKeyValid = ref<boolean>(true);

const restoreData = shallowRef<IBackupData>();
const legacyBackup = shallowRef<IParsedPtppBackup>();
const restoreOptions = ref<IRestoreOptions>({
  fields: [],
  expandCookieMinutes: 0,
  keepExistUserInfo: true,
});

const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();

function buildBackupOptions() {
  restoreOptions.value = {
    fields: [...Object.keys(restoreData.value?.manifest?.files ?? {})] as TBackupFields[],
    expandCookieMinutes: 0,
    keepExistUserInfo: true,
  };
  currentStep.value = "restore";
}

function buildLegacyBackupOptions(data: IParsedPtppBackup) {
  restoreOptions.value = {
    fields: [...data.availableFields],
    expandCookieMinutes: 0,
    keepExistUserInfo: true,
  };
  currentStep.value = "restore";
}

const availableRestoreFields = computed(() =>
  legacyBackup.value
    ? new Set<TBackupFields>(legacyBackup.value.availableFields)
    : new Set<TBackupFields>(Object.keys(restoreData.value?.manifest?.files ?? {}) as TBackupFields[]),
);
const hasLoadedBackup = computed(() => Boolean(restoreData.value || legacyBackup.value));

/**
 * 如果是本地的文件，我们直接在 options 中解析，如果是服务器的文件，我们则在 offscreen 中解析
 */

const backupFile = shallowRef<File>();
async function loadLocalBackupFile() {
  if (!backupFile.value) return;
  restoreData.value = undefined;
  legacyBackup.value = undefined;
  try {
    restoreData.value = await jsZipBlobToBackupData(backupFile.value, decryptKey.value);
    isDecryptKeyValid.value = true;
    buildBackupOptions();
    return;
  } catch {
    // The normal PTD parser rejects legacy manifests. Try the PTPP parser next.
  }

  try {
    legacyBackup.value = await parsePtppBackup(backupFile.value, decryptKey.value);
    isDecryptKeyValid.value = true;
    buildLegacyBackupOptions(legacyBackup.value);
  } catch (err) {
    console.error(err);
    isDecryptKeyValid.value = false;
    runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.loadFailure", { error: err }), { color: "error" });
  }
}

const isLoadingRemoteBackupFile = ref<boolean>(false);
function loadRemoteBackupFile() {
  if (restoreMetadata.type === "remote") {
    isLoadingRemoteBackupFile.value = true;
    sendMessage("getRemoteBackupData", {
      backupServerId: restoreMetadata.server,
      path: restoreMetadata.path,
      decryptKey: decryptKey.value,
    })
      .then((data) => {
        restoreData.value = data;
        isDecryptKeyValid.value = true;
        buildBackupOptions();
      })
      .catch((err) => {
        runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.loadFailure", { error: err }), { color: "error" });
        console.error(err);
        isDecryptKeyValid.value = false;
      })
      .finally(() => {
        isLoadingRemoteBackupFile.value = false;
      });
  }
}

function extractVersion(str: string = "") {
  const regex = /v(\d+\.\d+\.\d+(?:\.\d+)?)/;
  const match = str.match(regex);
  return match ? match[1] : null;
}

/**
 *
 * 比较两个版本号字符串
 *
 * inputV1 < inputV2 返回 -1
 * inputV1 = inputV2 返回 0
 * inputV1 > inputV2 返回 1
 *
 */
function compareVersion(inputV1?: string, inputV2?: string) {
  const v1 = extractVersion(inputV1);
  const v2 = extractVersion(inputV2);

  if (!v1 || !v2) return null;

  const parts1 = v1.split(".").map(Number);
  const parts2 = v2.split(".").map(Number);
  const maxLength = Math.max(parts1.length, parts2.length);

  for (let i = 0; i < maxLength; i++) {
    const num1 = parts1[i] || 0;
    const num2 = parts2[i] || 0;

    if (num1 > num2) return 1;
    if (num1 < num2) return -1;
  }

  return 0;
}

const isDoingRestore = ref<boolean>(false);
function doRestore() {
  isDoingRestore.value = true;

  if (
    restoreOptions.value.fields?.includes("userInfo") &&
    restoreOptions.value.keepExistUserInfo === false &&
    !confirm(t("SetBackup.RestoreDialog.confirmReplaceUserInfo"))
  ) {
    isDoingRestore.value = false;
    return;
  }

  if (legacyBackup.value) {
    sendMessage("importPtppLegacyBackup", {
      ...legacyBackup.value.payload,
      fields: restoreOptions.value.fields ?? [],
      expandCookieMinutes: restoreOptions.value.expandCookieMinutes,
      keepExistUserInfo: restoreOptions.value.keepExistUserInfo,
    })
      .then((result) => {
        runtimeStore.showSnakebar(
          t("SetBackup.RestoreDialog.legacyImportSuccess", {
            sites: result.importedCounts.sites ?? 0,
            downloaders: result.importedCounts.downloaders ?? 0,
            userHistory: result.importedCounts.userHistory ?? 0,
            downloadHistory: result.importedCounts.downloadHistory ?? 0,
            cookies: result.restoredCookies,
            failedCookies: result.failedCookies,
            skipped: result.skippedSiteIds.length,
          }),
          { color: result.failedCookies > 0 || result.warningCount > 0 ? "warning" : "success" },
        );
        showDialog.value = false;
      })
      .catch((err) => {
        runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.failure", { error: err }), { color: "error" });
        console.error(err);
      })
      .finally(() => {
        isDoingRestore.value = false;
      });
    return;
  }

  // 检查 version 字段
  if (!restoreData.value?.manifest?.version) {
    runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.missingVersion"), { color: "error" });
    isDoingRestore.value = false;
    return;
  }

  const warnRestore = compareVersion(restoreData.value.manifest.version, __EXT_VERSION__) == 1;
  if (warnRestore && !confirm(t("SetBackup.RestoreDialog.versionWarning"))) {
    isDoingRestore.value = false;
    return;
  }

  sendMessage("restoreBackupData", { restoreData: restoreData.value!, restoreOptions: restoreOptions.value })
    .then(() => {
      runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.success"), { color: "success" });
      showDialog.value = false;
    })
    .catch((err) => {
      runtimeStore.showSnakebar(t("SetBackup.RestoreDialog.failure", { error: err }), { color: "error" });
      console.error(err);
    })
    .finally(() => {
      isDoingRestore.value = false;
    });
}

function convertIsoDurationToMinutes(duration: string): number {
  const regex = /P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?/;
  const match = duration.match(regex);

  if (!match) {
    throw new Error(`Invalid ISO 8601 duration format: ${duration}`);
  }

  const [, years, months, weeks, days, hours, minutes, seconds] = match;

  // 转换各时间单位为分钟
  const minutesFromYears = years ? parseInt(years, 10) * 365 * 24 * 60 : 0;
  const minutesFromMonths = months ? parseInt(months, 10) * 30 * 24 * 60 : 0; // 近似值，每月按30天计算
  const minutesFromWeeks = weeks ? parseInt(weeks, 10) * 7 * 24 * 60 : 0;
  const minutesFromDays = days ? parseInt(days, 10) * 24 * 60 : 0;
  const minutesFromHours = hours ? parseInt(hours, 10) * 60 : 0;
  const minutesFromMinutes = minutes ? parseInt(minutes, 10) : 0;
  const minutesFromSeconds = seconds ? parseInt(seconds, 10) / 60 : 0;

  // 计算总分钟数
  return (
    minutesFromYears +
    minutesFromMonths +
    minutesFromWeeks +
    minutesFromDays +
    minutesFromHours +
    minutesFromMinutes +
    minutesFromSeconds
  );
}

function resetDialog() {
  currentStep.value = restoreMetadata.type;
  decryptKey.value = configStore.backup.encryptionKey ?? "";

  restoreData.value = undefined;
  legacyBackup.value = undefined;
  if (restoreMetadata.type === "file") {
    backupFile.value = undefined;
  } else if (restoreMetadata.type == "remote") {
    loadRemoteBackupFile();
  }
}
</script>

<template>
  <v-dialog
    v-if="showDialog"
    v-model="showDialog"
    :aria-label="t('SetBackup.RestoreDialog.title')"
    :persistent="isDoingRestore"
    max-width="800"
    scrollable
    @after-enter="resetDialog"
  >
    <v-card>
      <v-card-title class="pa-0">
        <v-toolbar color="blue-grey-darken-2">
          <v-toolbar-title>{{ t("SetBackup.RestoreDialog.title") }}</v-toolbar-title>
        </v-toolbar>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-alert class="mb-3" type="info" variant="tonal">
          {{ t("SetBackup.RestoreDialog.autoDetectBackup") }}
        </v-alert>
        <v-window v-model="currentStep">
          <v-window-item value="file" eager>
            <v-file-input
              v-model="backupFile"
              accept="application/zip"
              :label="t('SetBackup.RestoreDialog.selectFile')"
              :placeholder="t('SetBackup.RestoreDialog.selectFile')"
              show-size
              @update:model-value="loadLocalBackupFile"
            />
            <v-text-field
              v-model="decryptKey"
              :append-icon="showDecryptKey ? 'mdi-eye' : 'mdi-eye-off'"
              :type="showDecryptKey ? 'text' : 'password'"
              :label="t('SetBackup.RestoreDialog.decryptKey')"
              @click:append="showDecryptKey = !showDecryptKey"
            />
            <v-btn
              v-if="!isDecryptKeyValid"
              :disabled="!backupFile"
              prepend-icon="mdi-cached"
              block
              color="warning"
              :text="t('SetBackup.RestoreDialog.retry')"
              @click="loadLocalBackupFile"
            />
          </v-window-item>
          <v-window-item value="remote" eager>
            <v-text-field
              v-model="decryptKey"
              :append-icon="showDecryptKey ? 'mdi-eye' : 'mdi-eye-off'"
              :type="showDecryptKey ? 'text' : 'password'"
              :label="t('SetBackup.RestoreDialog.decryptKey')"
              @click:append="showDecryptKey = !showDecryptKey"
            />
            <v-btn
              v-if="!isDecryptKeyValid"
              :loading="isLoadingRemoteBackupFile"
              prepend-icon="mdi-cached"
              block
              color="warning"
              :text="t('SetBackup.RestoreDialog.retry')"
              @click="loadRemoteBackupFile"
            />
          </v-window-item>
          <v-window-item value="restore">
            <v-alert v-if="legacyBackup" class="mb-3" type="success" variant="tonal">
              {{ t("SetBackup.RestoreDialog.legacyDetected", { version: legacyBackup.manifest.version ?? "-" }) }}
              <div v-if="legacyBackup.hasCollections" class="mt-1 text-caption">
                {{ t("SetBackup.RestoreDialog.legacyCollectionsNotice") }}
              </div>
            </v-alert>
            <v-alert
              v-if="
                legacyBackup &&
                ['cookies', 'config', 'metadata'].some((field) => restoreOptions.fields?.includes(field as TBackupFields))
              "
              class="mb-3"
              type="warning"
              variant="tonal"
            >
              {{ t("SetBackup.RestoreDialog.legacyCredentialsNotice") }}
            </v-alert>
            <v-label>{{ t("SetBackup.RestoreDialog.restoreOptions") }}</v-label>
            <v-row no-gutters>
              <v-col v-for="backupField in BackupFields" :key="backupField" cols="12" md="4">
                <v-switch
                  v-model="restoreOptions.fields"
                  :label="t(`SetBackup.fields.${backupField}`)"
                  :value="backupField"
                  color="success"
                  :disabled="!availableRestoreFields.has(backupField)"
                  hide-details
                />
              </v-col>
            </v-row>

            <v-card class="mt-4" variant="outlined" :disabled="!restoreOptions.fields?.includes('cookies')">
              <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
                <v-icon color="primary" icon="mdi-cookie-clock" />
                {{ t("SetBackup.RestoreDialog.cookiePolicyTitle") }}
              </v-card-title>
              <v-card-text>
                <v-number-input
                  v-model="restoreOptions.expandCookieMinutes"
                  :label="t('SetBackup.RestoreDialog.expandCookieMinutes')"
                  :disabled="!restoreOptions.fields?.includes('cookies')"
                  :hint="t('SetBackup.RestoreDialog.expandCookieHint')"
                  persistent-hint
                  :min="0"
                  :step="1"
                />
                <div class="d-flex flex-wrap ga-2 mt-3">
                  <v-chip
                    v-for="preset in [
                      { label: '30m', value: 'PT30M' },
                      { label: '1h', value: 'PT1H' },
                      { label: '12h', value: 'PT12H' },
                      { label: '1d', value: 'P1D' },
                      { label: '1w', value: 'P1W' },
                      { label: '1mo', value: 'P1M' },
                      { label: '6mo', value: 'P6M' },
                      { label: '1y', value: 'P1Y' },
                    ]"
                    :key="preset.value"
                    :color="
                      restoreOptions.expandCookieMinutes === convertIsoDurationToMinutes(preset.value)
                        ? 'primary'
                        : undefined
                    "
                    size="small"
                    variant="tonal"
                    @click="restoreOptions.expandCookieMinutes = convertIsoDurationToMinutes(preset.value)"
                  >
                    {{ preset.label }}
                  </v-chip>
                </div>
              </v-card-text>
            </v-card>

            <v-card class="mt-4" variant="outlined" :disabled="!restoreOptions.fields?.includes('userInfo')">
              <v-card-title class="text-subtitle-1 d-flex align-center ga-2">
                <v-icon color="primary" icon="mdi-database-sync" />
                {{ t("SetBackup.RestoreDialog.userInfoPolicyTitle") }}
              </v-card-title>
              <v-card-text>
                <v-radio-group v-model="restoreOptions.keepExistUserInfo" hide-details>
                  <v-radio :label="t('SetBackup.RestoreDialog.userInfoMerge')" :value="true" color="success" />
                  <div class="text-caption text-medium-emphasis ml-8 mb-2">
                    {{ t("SetBackup.RestoreDialog.userInfoMergeHint") }}
                  </div>
                  <v-radio :label="t('SetBackup.RestoreDialog.userInfoReplace')" :value="false" color="warning" />
                  <div class="text-caption text-medium-emphasis ml-8">
                    {{ t("SetBackup.RestoreDialog.userInfoReplaceHint") }}
                  </div>
                </v-radio-group>
              </v-card-text>
            </v-card>
          </v-window-item>
        </v-window>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-spacer />
        <v-btn
          :disabled="isDoingRestore"
          color="error"
          prepend-icon="mdi-close-circle"
          variant="text"
          @click="showDialog = false"
        >
          {{ t("common.dialog.cancel") }}
        </v-btn>
        <v-btn
          v-if="currentStep == 'restore'"
          color="blue-darken-1"
          prepend-icon="mdi-chevron-left"
          variant="text"
          @click="currentStep = restoreMetadata.type"
        >
          {{ t("common.dialog.prev") }}
        </v-btn>
        <v-btn
          v-if="currentStep != 'restore'"
          :disabled="!hasLoadedBackup"
          append-icon="mdi-chevron-right"
          color="blue-darken-1"
          variant="text"
          @click="currentStep = 'restore'"
        >
          {{ t("common.dialog.next") }}
        </v-btn>
        <v-btn
          v-if="currentStep == 'restore'"
          :loading="isDoingRestore"
          color="success"
          prepend-icon="mdi-import"
          variant="text"
          @click="doRestore"
        >
          {{ t("common.dialog.ok") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss"></style>
