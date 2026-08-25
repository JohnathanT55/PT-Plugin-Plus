<script setup lang="ts">
import { computed, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import type { DataTableHeader } from "vuetify";
import type { IBackupCleanupPreview, IClassifiedBackupFile } from "@foundation/backup/retention";

import { sendMessage } from "@/messages.ts";
import { formatDate, formatSize } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const showDialog = defineModel<boolean>();
const { backupServerId } = defineProps<{ backupServerId: string }>();
const emit = defineEmits<{ (event: "completed"): void }>();

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const preview = shallowRef<IBackupCleanupPreview>();
const selected = ref<string[]>([]);
const includeLegacyOnce = ref(false);
const isLoading = ref(false);
const isExecuting = ref(false);
const error = ref("");
const showConfirm = ref(false);

const headers = [
  { title: t("SetBackup.HistoryDialog.table.filename"), key: "filename", align: "start" },
  { title: t("SetBackup.HistoryDialog.table.type"), key: "classification", align: "start" },
  { title: t("SetBackup.HistoryDialog.table.retention"), key: "disposition", align: "start" },
  { title: t("SetBackup.HistoryDialog.table.size"), key: "size", align: "end" },
  { title: t("SetBackup.HistoryDialog.table.time"), key: "time", align: "start" },
] as DataTableHeader[];

const tableItems = computed(() =>
  (preview.value?.files ?? []).map((file) => ({ ...file, selectable: file.disposition === "candidate" })),
);

async function loadPreview() {
  isLoading.value = true;
  error.value = "";
  try {
    preview.value = await sendMessage("previewBackupCleanup", {
      backupServerId,
      includeLegacyOnce: includeLegacyOnce.value,
    });
    selected.value = [...preview.value.candidatePaths];
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
    preview.value = undefined;
    selected.value = [];
  } finally {
    isLoading.value = false;
  }
}

async function executeCleanup() {
  if (!preview.value || selected.value.length === 0) return;
  isExecuting.value = true;
  error.value = "";
  try {
    const result = await sendMessage("executeBackupCleanup", {
      backupServerId,
      previewToken: preview.value.token,
      paths: selected.value,
      includeLegacyOnce: includeLegacyOnce.value,
    });
    runtimeStore.showSnakebar(
      t("SetBackup.HistoryDialog.cleanup.result", {
        deleted: result.deletedCount,
        failed: result.failedCount,
        skipped: result.skippedCount,
      }),
      { color: result.failedCount ? "warning" : "success" },
    );
    showConfirm.value = false;
    emit("completed");
    await loadPreview();
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
    showConfirm.value = false;
  } finally {
    isExecuting.value = false;
  }
}

function classificationLabel(file: IClassifiedBackupFile) {
  const classification = t(`SetBackup.HistoryDialog.classification.${file.classification}`);
  const trigger = file.identity ? t(`SetBackup.trigger.${file.identity.trigger}`) : "";
  return trigger ? `${classification} · ${trigger}` : classification;
}

function dispositionLabel(file: IClassifiedBackupFile) {
  return t(`SetBackup.HistoryDialog.disposition.${file.disposition}`);
}

function formatBackupTime(file: IClassifiedBackupFile) {
  const value = file.identity?.createdAt ?? file.time;
  return Number.isFinite(value) ? formatDate(value) : "—";
}

function identityDetail(file: IClassifiedBackupFile) {
  if (!file.identity) return "";
  return t("SetBackup.HistoryDialog.fileIdentity", {
    scope: t(`SetBackup.HistoryDialog.scope.${file.identity.scopeKind}`),
    encryption: t(`SetBackup.HistoryDialog.encryption.${file.identity.encryption}`),
    fingerprint: file.identity.scopeFingerprint,
  });
}

function resetDialog() {
  preview.value = undefined;
  selected.value = [];
  includeLegacyOnce.value = false;
  error.value = "";
  showConfirm.value = false;
}
</script>

<template>
  <v-dialog
    v-if="showDialog"
    v-model="showDialog"
    :aria-label="t('SetBackup.HistoryDialog.cleanup.title')"
    max-width="1100"
    scrollable
    @after-enter="loadPreview"
    @after-leave="resetDialog"
  >
    <v-card>
      <v-card-title class="pa-0">
        <v-toolbar color="blue-grey-darken-2">
          <v-toolbar-title>{{ t("SetBackup.HistoryDialog.cleanup.title") }}</v-toolbar-title>
          <template #append>
            <v-btn icon="mdi-close" :title="t('common.dialog.close')" @click="showDialog = false" />
          </template>
        </v-toolbar>
      </v-card-title>
      <v-card-text>
        <v-alert class="mb-3" type="info" variant="tonal">
          {{ t("SetBackup.HistoryDialog.cleanup.safety") }}
        </v-alert>
        <v-switch
          v-model="includeLegacyOnce"
          :label="t('SetBackup.HistoryDialog.cleanup.includeLegacyOnce')"
          :messages="t('SetBackup.HistoryDialog.cleanup.includeLegacyHint')"
          color="warning"
          hide-details="auto"
          @update:model-value="loadPreview"
        />
        <v-alert v-if="error" class="my-3" type="error" variant="tonal">{{ error }}</v-alert>

        <v-card v-if="preview" class="my-3" variant="tonal">
          <v-card-text class="d-flex flex-wrap ga-6">
            <div>{{ t("SetBackup.HistoryDialog.cleanup.keepCount", { count: preview.keepCount }) }}</div>
            <div>{{ t("SetBackup.HistoryDialog.cleanup.protectedCount", { count: preview.protectedCount }) }}</div>
            <div>{{ t("SetBackup.HistoryDialog.cleanup.candidateCount", { count: preview.candidateCount }) }}</div>
            <div>
              {{
                t("SetBackup.HistoryDialog.cleanup.releaseSize", {
                  size: formatSize(preview.candidateBytes),
                  unknown: preview.unknownCandidateSizeCount,
                })
              }}
            </div>
            <div v-if="preview.oldestCandidateAt && preview.newestCandidateAt">
              {{
                t("SetBackup.HistoryDialog.cleanup.dateRange", {
                  oldest: formatDate(preview.oldestCandidateAt),
                  newest: formatDate(preview.newestCandidateAt),
                })
              }}
            </div>
          </v-card-text>
        </v-card>

        <v-data-table
          v-if="preview"
          v-model="selected"
          :headers="headers"
          :items="tableItems"
          :loading="isLoading"
          class="table-header-no-wrap table-stripe"
          item-value="path"
          item-selectable="selectable"
          show-select
        >
          <template #item.filename="{ item }">
            <div class="py-1">
              <div>{{ item.filename }}</div>
              <div v-if="item.identity" class="text-caption text-medium-emphasis">
                {{ identityDetail(item) }}
              </div>
            </div>
          </template>
          <template #item.classification="{ item }">
            <v-chip size="small" variant="tonal">{{ classificationLabel(item) }}</v-chip>
          </template>
          <template #item.disposition="{ item }">
            <v-chip
              :color="
                item.disposition === 'candidate' ? 'warning' : item.disposition === 'protected' ? 'info' : 'success'
              "
              size="small"
              variant="tonal"
            >
              {{ dispositionLabel(item) }}
            </v-chip>
          </template>
          <template #item.size="{ item }">
            <span class="text-no-wrap">{{ item.size === "N/A" ? item.size : formatSize(item.size) }}</span>
          </template>
          <template #item.time="{ item }">
            <span class="text-no-wrap">{{ formatBackupTime(item) }}</span>
          </template>
        </v-data-table>
      </v-card-text>
      <v-divider />
      <v-card-actions>
        <v-spacer />
        <v-btn color="error" variant="text" @click="showDialog = false">{{ t("common.dialog.cancel") }}</v-btn>
        <v-btn
          :disabled="selected.length === 0 || isLoading"
          color="warning"
          prepend-icon="mdi-delete-clock"
          variant="flat"
          @click="showConfirm = true"
        >
          {{ t("SetBackup.HistoryDialog.cleanup.cleanSelected", { count: selected.length }) }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="showConfirm" max-width="560">
    <v-card>
      <v-card-title>{{ t("SetBackup.HistoryDialog.cleanup.confirmTitle") }}</v-card-title>
      <v-card-text>
        {{ t("SetBackup.HistoryDialog.cleanup.confirmText", { count: selected.length }) }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn :disabled="isExecuting" variant="text" @click="showConfirm = false">
          {{ t("common.dialog.cancel") }}
        </v-btn>
        <v-btn :loading="isExecuting" color="error" variant="flat" @click="executeCleanup">
          {{ t("common.dialog.ok") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
