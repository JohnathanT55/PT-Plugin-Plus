<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { computed, ref, shallowRef } from "vue";
import type { DataTableHeader } from "vuetify";
import type { IClassifiedBackupFile } from "@foundation/backup/retention";

import { sendMessage } from "@/messages.ts";
import { formatDate, formatSize } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import type { TBackupTrigger } from "@/shared/types.ts";

import DeleteDialog from "@/options/components/DeleteDialog.vue";
import NavButton from "@/options/components/NavButton.vue";
import RestoreDialog from "./RestoreDialog.vue";
import CleanupPreviewDialog from "./CleanupPreviewDialog.vue";

const showDialog = defineModel<boolean>();
const { backupServerId } = defineProps<{
  backupServerId: string;
}>();

const { t } = useI18n();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const isLoading = ref<boolean>(false);
const loadError = ref<string>("");
const backupHistory = shallowRef<IClassifiedBackupFile[]>([]);
const activeView = ref<"files" | "runs">("files");
const server = computed(() => metadataStore.backupServers[backupServerId]);

const tableHeaders = [
  { title: t("SetBackup.HistoryDialog.table.filename"), key: "filename", align: "start" },
  { title: t("SetBackup.HistoryDialog.table.type"), key: "classification", align: "start" },
  { title: t("SetBackup.HistoryDialog.table.retention"), key: "disposition", align: "start" },
  { title: t("SetBackup.HistoryDialog.table.size"), key: "size", align: "end" },
  { title: t("SetBackup.HistoryDialog.table.time"), key: "time", align: "start" },
  { title: t("common.action"), key: "action", sortable: false },
] as DataTableHeader[];
const runTableHeaders = [
  { title: t("SetBackup.HistoryDialog.runTable.time"), key: "finishedAt", align: "start" },
  { title: t("SetBackup.HistoryDialog.runTable.trigger"), key: "trigger", align: "start" },
  { title: t("SetBackup.HistoryDialog.runTable.result"), key: "status", align: "center" },
  { title: t("SetBackup.HistoryDialog.runTable.duration"), key: "durationMs", align: "end" },
  { title: t("SetBackup.HistoryDialog.runTable.fields"), key: "fields", sortable: false },
  { title: t("SetBackup.HistoryDialog.runTable.detail"), key: "error", sortable: false },
] as DataTableHeader[];
const tableSelected = ref<string[]>([]);
const showCleanupDialog = ref(false);

function triggerLabel(trigger: TBackupTrigger) {
  return t(`SetBackup.trigger.${trigger}`);
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`;
  return `${(durationMs / 60_000).toFixed(1)} min`;
}

function formatBackupTime(file: IClassifiedBackupFile) {
  const value = file.identity?.createdAt ?? file.time;
  return Number.isFinite(value) ? formatDate(value) : "—";
}

function classificationLabel(file: IClassifiedBackupFile) {
  const classification = t(`SetBackup.HistoryDialog.classification.${file.classification}`);
  return file.identity ? `${classification} · ${triggerLabel(file.identity.trigger)}` : classification;
}

function dispositionLabel(file: IClassifiedBackupFile) {
  return t(`SetBackup.HistoryDialog.disposition.${file.disposition}`);
}

function identityDetail(file: IClassifiedBackupFile) {
  if (!file.identity) return "";
  return t("SetBackup.HistoryDialog.fileIdentity", {
    scope: t(`SetBackup.HistoryDialog.scope.${file.identity.scopeKind}`),
    encryption: t(`SetBackup.HistoryDialog.encryption.${file.identity.encryption}`),
    fingerprint: file.identity.scopeFingerprint,
  });
}

const showRestoreDialog = ref<boolean>(false);
const restoreMetadata = ref<{ type: "remote"; server: string; path: string }>({ type: "remote", server: "", path: "" });
function restoreBackup(path: string) {
  restoreMetadata.value = { type: "remote", server: backupServerId, path };
  showRestoreDialog.value = true;
}

const showDeleteDialog = ref<boolean>(false);
const toDeleteBackupHistory = ref<string[]>([]);
async function deleteBackupHistory(paths: string[]) {
  showDeleteDialog.value = true;
  toDeleteBackupHistory.value = paths;
}

async function confirmDeleteBackupHistory(toDeleteId: string) {
  const toDeleteName = backupHistory.value.find((item) => item.path === toDeleteId)?.filename ?? toDeleteId;
  const deleteStatus = await sendMessage("deleteBackupHistory", { path: toDeleteId, backupServerId });
  if (!deleteStatus) {
    runtimeStore.showSnakebar(t("SetBackup.HistoryDialog.deleteFailure", { name: toDeleteName }), { color: "error" });
  } else {
    runtimeStore.showSnakebar(t("SetBackup.HistoryDialog.deleteSuccess", { name: toDeleteName }), { color: "success" });
    backupHistory.value = backupHistory.value.filter((item) => item.path !== toDeleteId);
  }
}

async function loadBackupHistory() {
  isLoading.value = true;
  loadError.value = "";
  try {
    backupHistory.value = await sendMessage("getBackupHistory", backupServerId);
  } catch (e) {
    console.error("获取备份历史失败", e);
    loadError.value = e instanceof Error ? e.message : String(e);
  } finally {
    isLoading.value = false;
  }
}

async function dialogEnter() {
  activeView.value = "files";
  // noinspection ES6MissingAwait
  loadBackupHistory();
}

async function dialogLeave() {
  backupHistory.value = [];
  tableSelected.value = [];
  loadError.value = "";
}
</script>

<template>
  <v-dialog
    v-if="showDialog"
    v-model="showDialog"
    :aria-label="
      t('SetBackup.HistoryDialog.title', {
        name: metadataStore.backupServers[backupServerId]?.name ?? backupServerId,
      })
    "
    max-width="1200"
    @after-enter="dialogEnter"
    @after-leave="dialogLeave"
  >
    <v-card>
      <v-card-title class="pa-0">
        <v-toolbar color="blue-grey-darken-2">
          <v-toolbar-title>
            {{
              t("SetBackup.HistoryDialog.title", {
                name: metadataStore.backupServers[backupServerId].name ?? backupServerId,
              })
            }}
          </v-toolbar-title>
          <template #append>
            <v-btn icon="mdi-close" :title="t('common.dialog.close')" @click="showDialog = false" />
          </template>
        </v-toolbar>
      </v-card-title>
      <v-divider />
      <v-card-text>
        <v-card class="mb-4" variant="tonal">
          <v-card-text class="d-flex flex-wrap ga-6 align-start">
            <div>
              <div class="text-caption text-medium-emphasis">
                {{ t("SetBackup.HistoryDialog.summary.lastSuccess") }}
              </div>
              <div>{{ server?.lastBackupAt ? formatDate(server.lastBackupAt) : "—" }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">
                {{ t("SetBackup.HistoryDialog.summary.lastAttempt") }}
              </div>
              <div>{{ server?.lastBackupAttemptAt ? formatDate(server.lastBackupAttemptAt) : "—" }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">{{ t("SetBackup.HistoryDialog.summary.trigger") }}</div>
              <div>{{ server?.lastBackupTrigger ? triggerLabel(server.lastBackupTrigger) : "—" }}</div>
            </div>
            <div>
              <div class="text-caption text-medium-emphasis">{{ t("SetBackup.HistoryDialog.summary.nextRun") }}</div>
              <div>{{ server?.nextBackupAt ? formatDate(server.nextBackupAt) : "—" }}</div>
            </div>
          </v-card-text>
          <v-alert v-if="server?.lastBackupError" class="ma-3 mt-0" density="compact" type="error" variant="tonal">
            <div class="font-weight-medium">{{ t("SetBackup.HistoryDialog.summary.lastFailure") }}</div>
            <div class="backup-error-detail">{{ server.lastBackupError }}</div>
            <div v-if="server.backupRetryAt" class="text-caption mt-1">
              {{
                t("SetBackup.table.retryAt", {
                  time: formatDate(server.backupRetryAt),
                  n: server.backupRetryCount ?? 1,
                })
              }}
            </div>
          </v-alert>
          <v-alert
            v-if="server?.lastCleanup"
            class="ma-3 mt-0"
            :type="server.lastCleanup.failedCount ? 'warning' : 'success'"
            density="compact"
            variant="tonal"
          >
            {{
              t("SetBackup.HistoryDialog.cleanup.lastResult", {
                deleted: server.lastCleanup.deletedCount,
                failed: server.lastCleanup.failedCount,
                skipped: server.lastCleanup.skippedCount,
              })
            }}
            <div v-if="server.lastCleanup.error" class="backup-error-detail">{{ server.lastCleanup.error }}</div>
          </v-alert>
        </v-card>

        <v-tabs v-model="activeView" color="primary" grow>
          <v-tab prepend-icon="mdi-folder-cloud" value="files">{{ t("SetBackup.HistoryDialog.tabs.files") }}</v-tab>
          <v-tab prepend-icon="mdi-timeline-clock" value="runs">
            {{ t("SetBackup.HistoryDialog.tabs.runs") }}
            <v-badge class="ml-2" :content="server?.backupHistory?.length ?? 0" inline />
          </v-tab>
        </v-tabs>
        <v-divider />

        <v-window v-model="activeView">
          <v-window-item value="files">
            <div class="d-flex align-center ga-2 my-3">
              <NavButton
                :disabled="tableSelected.length === 0"
                :text="t('common.remove')"
                color="error"
                icon="mdi-delete"
                @click="deleteBackupHistory(tableSelected)"
              />
              <NavButton
                :text="t('SetBackup.HistoryDialog.cleanup.previewButton')"
                color="warning"
                icon="mdi-delete-clock"
                @click="showCleanupDialog = true"
              />
              <v-btn
                :loading="isLoading"
                :title="t('common.refresh')"
                color="primary"
                icon="mdi-refresh"
                size="small"
                variant="text"
                @click="loadBackupHistory"
              />
            </div>

            <v-alert v-if="loadError" class="mb-3" density="compact" type="error" variant="tonal">
              {{ t("SetBackup.HistoryDialog.loadFailure", { error: loadError }) }}
            </v-alert>

            <v-data-table
              v-model="tableSelected"
              :headers="tableHeaders"
              :items="backupHistory"
              :sort-by="[{ key: 'time', order: 'desc' }]"
              :loading="isLoading"
              class="table-header-no-wrap table-stripe"
              item-value="path"
              must-sort
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
              <template #item.size="{ item }">
                <span class="text-no-wrap">{{ item.size !== "N/A" ? formatSize(item.size) : item.size }}</span>
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
              <template #item.time="{ item }">
                <span class="text-no-wrap">{{ formatBackupTime(item) }}</span>
              </template>
              <template #item.action="{ item }">
                <v-btn-group class="table-action" density="compact" variant="plain">
                  <v-btn
                    :title="t('SetBackup.HistoryDialog.restore')"
                    color="blue"
                    icon="mdi-cloud-download"
                    size="small"
                    @click="restoreBackup(item.path)"
                  />
                  <v-btn
                    :title="t('common.remove')"
                    color="error"
                    icon="mdi-delete"
                    size="small"
                    @click="deleteBackupHistory([item.path])"
                  />
                </v-btn-group>
              </template>
            </v-data-table>
          </v-window-item>

          <v-window-item value="runs">
            <v-data-table
              :headers="runTableHeaders"
              :items="server?.backupHistory ?? []"
              class="table-header-no-wrap table-stripe mt-3"
              item-value="id"
              :items-per-page="10"
            >
              <template #item.finishedAt="{ item }">
                <span class="text-no-wrap">{{ formatDate(item.finishedAt) }}</span>
              </template>
              <template #item.trigger="{ item }">
                <v-chip size="small" variant="tonal">{{ triggerLabel(item.trigger) }}</v-chip>
              </template>
              <template #item.status="{ item }">
                <v-chip
                  :color="item.status === 'success' ? 'success' : 'error'"
                  :prepend-icon="item.status === 'success' ? 'mdi-check-circle' : 'mdi-alert-circle'"
                  size="small"
                  variant="tonal"
                >
                  {{ t(`SetBackup.HistoryDialog.status.${item.status}`) }}
                </v-chip>
              </template>
              <template #item.durationMs="{ item }">
                <span class="text-no-wrap">{{ formatDuration(item.durationMs) }}</span>
              </template>
              <template #item.fields="{ item }">
                <v-chip size="small" variant="outlined">
                  {{ t("SetBackup.HistoryDialog.fieldCount", { count: item.fields?.length ?? 0 }) }}
                </v-chip>
              </template>
              <template #item.error="{ item }">
                <div v-if="item.error || item.cleanup" class="backup-error-detail">
                  <div v-if="item.cleanup" :class="item.cleanup.failedCount ? 'text-warning' : 'text-success'">
                    {{
                      t("SetBackup.HistoryDialog.cleanup.runResult", {
                        deleted: item.cleanup.deletedCount,
                        failed: item.cleanup.failedCount,
                        skipped: item.cleanup.skippedCount,
                      })
                    }}
                  </div>
                  <div v-if="item.error" class="text-error">{{ item.error }}</div>
                  <div v-if="item.cleanup?.error" class="text-warning">{{ item.cleanup.error }}</div>
                  <div v-if="item.retryIndex > 0" class="text-caption mt-1">
                    {{ t("SetBackup.HistoryDialog.retryNumber", { n: item.retryIndex }) }}
                  </div>
                </div>
                <span v-else class="text-medium-emphasis">—</span>
              </template>
            </v-data-table>
          </v-window-item>
        </v-window>
      </v-card-text>
    </v-card>
  </v-dialog>

  <RestoreDialog v-model="showRestoreDialog" :restore-metadata="restoreMetadata" />
  <CleanupPreviewDialog v-model="showCleanupDialog" :backup-server-id="backupServerId" @completed="loadBackupHistory" />
  <DeleteDialog
    v-model="showDeleteDialog"
    :confirm-delete="confirmDeleteBackupHistory"
    :to-delete-ids="toDeleteBackupHistory"
    @all-delete="loadBackupHistory"
  />
</template>

<style scoped lang="scss">
.backup-error-detail {
  max-width: 420px;
  overflow-wrap: anywhere;
  white-space: normal;
}
</style>
