import { computed, ref } from "vue";

import type { CTorrent } from "@ptd/downloader";
import { sendMessage } from "@/messages.ts";
import type { IClientTorrentListResult } from "@/shared/types.ts";
import { filterSupportedClientDownloaders, normalizeClientRefreshInterval } from "@/shared/clientDashboard.ts";
import { sanitizeDownloadErrorMessage } from "@/shared/downloadError.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useI18n } from "vue-i18n";

// ── module-level shared state ─────────────────────────────────────────────

/** Loaded torrent map keyed by clientId, shared between Index.vue and ClientStatusDialog.vue. */
export const torrents = ref<Record<string, CTorrent[]>>({});

/** Which downloader IDs are selected in the torrent filter (empty = all). */
export const selectedDownloaderIds = ref<string[]>([]);

/** Downloaders whose auto-refresh has been suspended due to ≥3 consecutive failures. */
export const suspendedDownloaders = ref(new Set<string>());

/** Whether auto-refresh is currently running. */
export const autoRefreshRunning = ref(false);

/** Last sanitized refresh error keyed by downloader ID. */
export const clientRefreshErrors = ref<Record<string, string>>({});

// private – not reactive, managed by the composable only
const failCounts = new Map<string, number>();
const refreshTimers = new Map<string, number>();

// ── composable ────────────────────────────────────────────────────────────

/**
 * Composable providing auto-refresh logic for the MyClient page.
 * All state is module-level and shared across component instances.
 */
export function useClientRefresh() {
  const { t } = useI18n();
  const metadataStore = useMetadataStore();
  const runtimeStore = useRuntimeStore();
  const configStore = useConfigStore();

  const enabledDownloaders = computed(() => filterSupportedClientDownloaders(metadataStore.getEnabledDownloaders));

  const activeDownloaderIds = computed(() => {
    const enabledIds = enabledDownloaders.value.map((downloader) => downloader.id);
    const enabledIdSet = new Set(enabledIds);
    const selectedEnabledIds = selectedDownloaderIds.value.filter((id) => enabledIdSet.has(id));
    return selectedEnabledIds.length > 0 ? selectedEnabledIds : enabledIds;
  });

  function clearDownloaderTimer(id: string) {
    const tid = refreshTimers.get(id);
    if (tid !== undefined) {
      clearTimeout(tid);
      refreshTimers.delete(id);
    }
  }

  async function loadSingleDownloader(id: string): Promise<IClientTorrentListResult> {
    let result: IClientTorrentListResult | undefined;
    try {
      const response = await sendMessage("getClientTorrents", id);
      result = response;
      if (!response.success) throw new Error(response.error || "下载器刷新失败");
      torrents.value = { ...torrents.value, [id]: response.data ?? [] };
      const { [id]: _removed, ...remainingErrors } = clientRefreshErrors.value;
      clientRefreshErrors.value = remainingErrors;
      failCounts.set(id, 0);
      return response;
    } catch (error) {
      const reason = sanitizeDownloadErrorMessage(result?.error || error) || "下载器刷新失败";
      clientRefreshErrors.value = { ...clientRefreshErrors.value, [id]: reason };
      const prev = failCounts.get(id) ?? 0;
      const next = prev + 1;
      failCounts.set(id, next);
      if (next >= 3) {
        suspendedDownloaders.value.add(id);
        clearDownloaderTimer(id);
        runtimeStore.showSnakebar(
          t("MyClient.autoRefresh.clientSuspended", {
            name: metadataStore.downloaders[id]?.name ?? id,
            reason,
          }),
          { color: "error", timeout: 8000 },
        );
      }
      return result ?? { success: false, action: "list", downloaderId: id, error: reason };
    }
  }

  function scheduleDownloaderRefresh(id: string) {
    if (!autoRefreshRunning.value) return;
    if (suspendedDownloaders.value.has(id)) return;
    const interval = normalizeClientRefreshInterval(configStore.download.clientAutoRefreshInterval);

    clearDownloaderTimer(id);
    const tid = window.setTimeout(async () => {
      await loadSingleDownloader(id);
      scheduleDownloaderRefresh(id);
    }, interval * 1000);
    refreshTimers.set(id, tid);
  }

  function stopAllTimers() {
    for (const id of refreshTimers.keys()) {
      clearDownloaderTimer(id);
    }
    autoRefreshRunning.value = false;
  }

  /** Reset failure-tracking and suspended state (call before a manual full reload). */
  function resetRefreshState() {
    suspendedDownloaders.value = new Set();
    clientRefreshErrors.value = {};
    failCounts.clear();
  }

  function rescheduleActiveDownloaders() {
    if (!autoRefreshRunning.value) return;
    const activeIds = new Set(activeDownloaderIds.value);
    for (const id of refreshTimers.keys()) {
      if (!activeIds.has(id)) clearDownloaderTimer(id);
    }
    for (const id of activeIds) scheduleDownloaderRefresh(id);
  }

  function resumeDownloaderRefresh(id: string) {
    suspendedDownloaders.value.delete(id);
    failCounts.set(id, 0);
    const { [id]: _removed, ...remainingErrors } = clientRefreshErrors.value;
    clientRefreshErrors.value = remainingErrors;
    if (autoRefreshRunning.value) {
      scheduleDownloaderRefresh(id);
    }
  }

  function startAutoRefresh() {
    autoRefreshRunning.value = true;
    for (const id of activeDownloaderIds.value) {
      scheduleDownloaderRefresh(id);
    }
  }

  function stopAutoRefresh() {
    stopAllTimers();
    resetRefreshState();
  }

  function toggleAutoRefresh() {
    if (autoRefreshRunning.value) {
      stopAutoRefresh();
    } else {
      startAutoRefresh();
    }
  }

  return {
    enabledDownloaders,
    activeDownloaderIds,
    loadSingleDownloader,
    clearDownloaderTimer,
    scheduleDownloaderRefresh,
    rescheduleActiveDownloaders,
    stopAllTimers,
    resetRefreshState,
    resumeDownloaderRefresh,
    startAutoRefresh,
    stopAutoRefresh,
    toggleAutoRefresh,
  };
}
