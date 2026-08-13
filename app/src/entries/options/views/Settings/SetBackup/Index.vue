<script setup lang="ts">
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { getBackupServerIcon } from "@ptd/backupServer";
import type { DataTableHeader } from "vuetify";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate } from "@/options/utils.ts";
import { BackupFields, type TBackupServerKey, type TBackupTrigger } from "@/shared/types.ts";
import { sendMessage } from "@/messages.ts";

import NavButton from "@/options/components/NavButton.vue";
import DeleteDialog from "@/options/components/DeleteDialog.vue";
import AddDialog from "./AddDialog.vue";
import EditDialog from "./EditDialog.vue";
import LocalExportConfirmDialog from "./LocalExportConfirmDialog.vue";
import HistoryDialog from "./HistoryDialog.vue";
import RestoreDialog from "./RestoreDialog.vue";

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();

const showAddDialog = ref<boolean>(false);
const showLocalExportConfirmDialog = ref<boolean>(false);
const showHistoryDialog = ref<boolean>(false);
const showEditDialog = ref<boolean>(false);
const showRestoreDialog = ref<boolean>(false);
const showDeleteDialog = ref<boolean>(false);

const fullTableHeader = [
  { title: t("common.type"), key: "type", align: "center" },
  { title: t("common.name"), key: "name", align: "start" },
  {
    title: t("SetBackup.table.backupFields"),
    key: "backupFields",
    align: "start",
    sortable: false,
    cellProps: { class: "pt-1" },
  },
  { title: t("SetBackup.table.backupInterval"), key: "backupInterval", align: "center" },
  { title: t("SetBackup.table.lastBackupAt"), key: "lastBackupAt", align: "end" },
  { title: t("SetBackup.table.status"), key: "status", align: "start", sortable: false },
  { title: t("common.enable"), key: "enabled", align: "center" },
  { title: t("common.action"), key: "action", sortable: false },
] as DataTableHeader[];
const tableSelected = ref<TBackupServerKey[]>([]);
const tableSearch = ref("");

function triggerLabel(trigger: TBackupTrigger) {
  return t(`SetBackup.trigger.${trigger}`);
}

const localBackup = Symbol("localBackup");
const doBackupStatus = ref<Record<TBackupServerKey | symbol, boolean>>({});
async function doBackup(backupServerId: TBackupServerKey | symbol) {
  doBackupStatus.value[backupServerId] = true;

  if (typeof backupServerId == "string") {
    try {
      const backupStatus = await sendMessage("runBackup", { backupServerId, trigger: "manual" });
      if (backupStatus) {
        runtimeStore.showSnakebar(t("SetBackup.snackbar.success"), { color: "success" });
      } else {
        runtimeStore.showSnakebar(t("SetBackup.snackbar.failure"), { color: "error" });
      }
    } catch {
      runtimeStore.showSnakebar(t("SetBackup.snackbar.failure"), { color: "error" });
    }
  } else if (backupServerId == localBackup) {
    showLocalExportConfirmDialog.value = true;
  } else {
    console.log('"doBackup" without valid backupServerId');
  }

  doBackupStatus.value[backupServerId] = false;
}

const toEditBackupServerId = ref<TBackupServerKey | null>(null);
function editBackupServer(id: TBackupServerKey) {
  toEditBackupServerId.value = id;
  showEditDialog.value = true;
}

const toShowHistoryBackupServerId = ref<TBackupServerKey | null>(null);
function showHistory(id: TBackupServerKey) {
  toShowHistoryBackupServerId.value = id;
  showHistoryDialog.value = true;
}

const toDeleteIds = ref<TBackupServerKey[]>([]);
function deleteBackupServer(ids: TBackupServerKey[]) {
  toDeleteIds.value = ids;
  showDeleteDialog.value = true;
}

async function confirmDeleteBackupServer(id: TBackupServerKey) {
  return await metadataStore.removeBackupServer(id);
}
</script>

<template>
  <v-alert class="mb-3" :title="t('route.Settings.SetBackup')" density="compact" type="info" variant="tonal" />
  <v-card class="set-backup" variant="outlined">
    <v-card-title class="ptpp-page-toolbar px-3 py-2">
      <v-row class="ma-0">
        <NavButton :text="t('common.btn.add')" color="success" icon="mdi-plus" @click="showAddDialog = true" />
        <NavButton
          :disabled="tableSelected.length === 0"
          :text="t('common.remove')"
          color="error"
          icon="mdi-minus"
          @click="deleteBackupServer(tableSelected)"
        />

        <v-divider class="mx-2" inset vertical />

        <NavButton
          :loading="doBackupStatus[localBackup]"
          color="success"
          icon="mdi-database-export"
          :text="t('SetBackup.localExport')"
          @click="doBackup(localBackup)"
        />
        <NavButton
          color="blue"
          icon="mdi-database-import"
          :text="t('SetBackup.localImport')"
          @click="() => (showRestoreDialog = true)"
        />

        <v-spacer />

        <v-text-field
          v-model="tableSearch"
          clearable
          density="compact"
          hide-details
          :label="t('SetBackup.searchPlaceholder')"
          max-width="420"
          prepend-inner-icon="mdi-magnify"
          single-line
        />
      </v-row>
    </v-card-title>

    <v-data-table
      v-model="tableSelected"
      :headers="fullTableHeader"
      :filter-keys="['id', 'name', 'type']"
      :items="metadataStore.getBackupServers"
      :search="tableSearch"
      item-value="id"
      class="table-stripe table-header-no-wrap"
      show-select
    >
      <template #item.type="{ item }">
        <v-avatar :image="getBackupServerIcon(item.type)" :alt="item.type" :title="item.type" />
      </template>

      <template #item.backupFields="{ item }">
        <v-chip v-for="backupField in item.backupFields" label :key="backupField" class="mr-1 mb-1">
          {{ t(`SetBackup.fields.${backupField}`) }}
        </v-chip>
      </template>

      <template #item.backupInterval="{ item }">
        <template v-if="item.backupInterval && item.backupInterval > 0">
          {{ t("SetBackup.table.everyNHour", { n: item.backupInterval }) }}
        </template>
        <span v-else class="text-disabled">—</span>
      </template>

      <template #item.lastBackupAt="{ item }">
        <div class="py-1 text-no-wrap">
          <div>{{ item.lastBackupAt ? formatDate(item.lastBackupAt) : t("SetBackup.table.notBackup") }}</div>
          <div v-if="item.lastBackupAttemptAt" class="text-caption text-medium-emphasis">
            {{ t("SetBackup.table.lastAttemptAt", { time: formatDate(item.lastBackupAttemptAt) }) }}
          </div>
        </div>
      </template>

      <template #item.status="{ item }">
        <div class="d-flex flex-column ga-1 py-1">
          <v-chip
            v-if="item.lastBackupError"
            :title="item.lastBackupError"
            color="error"
            prepend-icon="mdi-alert-circle-outline"
            size="small"
          >
            {{ t("SetBackup.table.failed") }}
          </v-chip>
          <v-chip v-else-if="item.lastBackupAt" color="success" prepend-icon="mdi-check-circle-outline" size="small">
            {{ t("SetBackup.table.success") }}
          </v-chip>
          <v-chip v-if="item.lastBackupTrigger" size="x-small" variant="outlined">
            {{ triggerLabel(item.lastBackupTrigger) }}
          </v-chip>
          <span v-if="item.lastBackupError" class="text-error text-caption backup-error" :title="item.lastBackupError">
            {{ item.lastBackupError }}
          </span>
          <span v-if="item.backupRetryAt" class="text-warning text-caption">
            {{ t("SetBackup.table.retryAt", { time: formatDate(item.backupRetryAt), n: item.backupRetryCount ?? 1 }) }}
          </span>
          <span v-else-if="item.nextBackupAt && item.backupInterval" class="text-medium-emphasis text-caption">
            {{ t("SetBackup.table.nextBackupAt", { time: formatDate(item.nextBackupAt) }) }}
          </span>
        </div>
      </template>

      <template #item.enabled="{ item }">
        <v-switch
          v-model="item.enabled"
          :aria-label="t('common.accessibility.settingForItem', { setting: t('common.enable'), name: item.name })"
          class="table-switch-btn"
          color="success"
          hide-details
          @update:model-value="(v) => metadataStore.simplePatch('backupServers', item.id, 'enabled', v as boolean)"
        />
      </template>
      <template #item.action="{ item }">
        <v-btn-group class="table-action" density="compact" variant="plain">
          <v-btn
            :title="t('SetBackup.table.action.backupNow')"
            :loading="doBackupStatus[item.id]"
            color="green"
            icon="mdi-cloud-upload"
            size="small"
            @click="doBackup(item.id)"
          />
          <v-btn
            :title="t('SetBackup.table.action.viewBackupDetails')"
            icon="mdi-view-list"
            size="small"
            @click="showHistory(item.id)"
          />

          <v-btn
            :title="t('common.edit')"
            color="info"
            icon="mdi-pencil"
            size="small"
            @click="editBackupServer(item.id)"
          />

          <v-btn
            :title="t('common.remove')"
            color="error"
            icon="mdi-delete"
            size="small"
            @click="deleteBackupServer([item.id])"
          />
        </v-btn-group>
      </template>
    </v-data-table>
  </v-card>

  <AddDialog v-model="showAddDialog" />
  <EditDialog v-model="showEditDialog" :client-id="toEditBackupServerId!" />
  <DeleteDialog v-model="showDeleteDialog" :to-delete-ids="toDeleteIds" :confirm-delete="confirmDeleteBackupServer" />
  <HistoryDialog v-model="showHistoryDialog" :backup-server-id="toShowHistoryBackupServerId!" />
  <LocalExportConfirmDialog v-model="showLocalExportConfirmDialog" />
  <RestoreDialog v-model="showRestoreDialog" :restore-metadata="{ type: 'file' }" />
</template>

<style scoped lang="scss">
.backup-error {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
