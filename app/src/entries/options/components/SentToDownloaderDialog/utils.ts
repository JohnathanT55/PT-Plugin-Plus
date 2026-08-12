import type { ITorrent } from "@ptd/site";
import type { CAddTorrentOptions } from "@ptd/downloader";
import type { IDownloadTorrentOption, TDownloaderKey } from "@/shared/types.ts";
import { formatDate, formatSize } from "@/options/utils.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { sendMessage } from "@/messages.ts";
import { preflightBatch } from "@/shared/batchPreflight.ts";
import { batchTorrentSizeBytes, executeSerialBatch, shouldConfirmBatchSize } from "@/shared/downloadBatchPolicy.ts";

export interface TorrentDownloadAssignment {
  torrent: ITorrent;
  downloaderId: TDownloaderKey;
  addTorrentOptions: CAddTorrentOptions;
}

export interface SendTorrentSummary {
  totalCount: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
}

export async function dispatchDownloadOptions(items: IDownloadTorrentOption[]): Promise<SendTorrentSummary> {
  const runtimeStore = useRuntimeStore();
  const configStore = useConfigStore();

  if (items.length === 0) {
    runtimeStore.showSnakebar("似乎并没有任务发送到下载器", { color: "warning" });
    return { totalCount: 0, successCount: 0, pendingCount: 0, failedCount: 0 };
  }

  if (
    shouldConfirmBatchSize(
      items.map((item) => item.torrent),
      configStore.download.needConfirmWhenExceedSize,
      configStore.download.exceedSize,
      configStore.download.exceedSizeUnit,
    )
  ) {
    const totalSize = formatSize(batchTorrentSizeBytes(items.map((item) => item.torrent)));
    const confirmed = window.confirm(
      `所选种子总体积约为 ${totalSize}，已超过 ${configStore.download.exceedSize} ${configStore.download.exceedSizeUnit}。是否继续推送？`,
    );
    if (!confirmed) {
      runtimeStore.showSnakebar("已取消批量推送", { color: "info" });
      return { totalCount: 0, successCount: 0, pendingCount: 0, failedCount: 0 };
    }
  }

  if (configStore.download.enableBackgroundDownload) {
    await sendMessage("queueDownloadBatch", {
      items,
      intervalSeconds: configStore.download.batchDownloadInterval,
    });
    runtimeStore.showSnakebar(`已创建包含 ${items.length} 项的后台下载任务`, { color: "success" });
    return { totalCount: items.length, successCount: 0, pendingCount: items.length, failedCount: 0 };
  }

  const status = await executeSerialBatch(
    items,
    async (item) => {
      try {
        return await sendMessage("downloadTorrent", item);
      } catch (error) {
        runtimeStore.showSnakebar(`[${item.torrent.title}] 下载失败！错误信息： ${error}`, { color: "error" });
        return undefined;
      }
    },
    Math.max(0, Number(configStore.download.batchDownloadInterval ?? 0)) * 1000,
  );

  const failedCount = status.filter((item) => !item || item.downloadStatus === "failed").length;
  const pendingCount = status.filter((item) => item?.downloadStatus === "pending").length;
  runtimeStore.showSnakebar(
    `成功发送 ${status.length - failedCount} 个任务到下载器` +
      (pendingCount > 0 ? `（${pendingCount}在下载队列中）` : "") +
      (failedCount > 0 ? `，有 ${failedCount} 个任务发送失败` : ""),
    { color: failedCount > 0 ? "warning" : "success" },
  );
  return {
    totalCount: status.length,
    successCount: status.length - failedCount,
    pendingCount,
    failedCount,
  };
}

function replaceInteractivePlaceholders(addTorrentOptions: CAddTorrentOptions): CAddTorrentOptions {
  const result = { ...addTorrentOptions };
  for (const key of ["savePath", "label"] as (keyof CAddTorrentOptions)[]) {
    const value = result[key];
    if (typeof value === "string" && value.includes("<...>")) {
      const userInput = prompt(`请输入替换 ${key} 中的 <...> 的内容：`);
      if (userInput === null) {
        throw new Error(`因取消输入 ${key} 中的 <...> 的内容而停止推送`);
      }
      (result[key] as string) = value.replace("<...>", userInput.trim());
    }
  }
  return result;
}

async function buildTorrentOptions(
  assignment: TorrentDownloadAssignment,
  baseReplaceMap: Record<string, string>,
): Promise<CAddTorrentOptions> {
  const metadataStore = useMetadataStore();
  const { torrent } = assignment;
  const realAddTorrentOptions = replaceInteractivePlaceholders(assignment.addTorrentOptions);
  const replaceMap: Record<string, string> = {
    "torrent.title": torrent.title ?? "",
    "torrent.subTitle": torrent.subTitle ?? "",
    "torrent.category": (torrent.category as string) ?? "",
    ...baseReplaceMap,
  };

  if (torrent.site) {
    replaceMap["torrent.site"] = torrent.site;
    replaceMap["torrent.siteName"] = await metadataStore.getSiteName(torrent.site);
  }

  for (const key of ["savePath", "label"] as (keyof CAddTorrentOptions)[]) {
    const value = realAddTorrentOptions[key];
    if (typeof value !== "string") continue;
    if (value === "") {
      delete realAddTorrentOptions[key];
      continue;
    }
    let replaced = value;
    for (const [replaceKey, replacement] of Object.entries(replaceMap)) {
      replaced = replaced.replaceAll(`$${replaceKey}$`, replacement);
    }
    (realAddTorrentOptions[key] as string) = replaced;
  }
  return realAddTorrentOptions;
}

export async function sendTorrentAssignments(assignments: TorrentDownloadAssignment[]): Promise<SendTorrentSummary> {
  const runtimeStore = useRuntimeStore();
  const metadataStore = useMetadataStore();
  const nowDate = new Date();
  const baseReplaceMap: Record<string, string> = {
    "date:YYYY": formatDate(nowDate, "yyyy"),
    "date:MM": formatDate(nowDate, "MM"),
    "date:DD": formatDate(nowDate, "dd"),
  };
  if (runtimeStore.search.searchKey !== "") {
    baseReplaceMap["search:keyword"] = runtimeStore.search.searchKey;
  }
  if (runtimeStore.search.searchPlanKey !== "") {
    baseReplaceMap["search:plan"] = metadataStore.getSearchSolutionName(runtimeStore.search.searchPlanKey);
  }

  const preflight = await preflightBatch(assignments, async (assignment) => {
    const downloader = metadataStore.downloaders[assignment.downloaderId];
    if (!downloader?.enabled) {
      throw new Error(`下载器 ${assignment.downloaderId} 不存在或已停用`);
    }
    if (assignment.torrent.site && downloader.excludedSites?.includes(assignment.torrent.site)) {
      throw new Error(`下载器 ${downloader.name} 已排除站点 ${assignment.torrent.site}`);
    }
    return {
      assignment,
      addTorrentOptions: await buildTorrentOptions(assignment, baseReplaceMap),
    };
  });

  if (!preflight.ok) {
    const failedTitles = preflight.failures
      .map(({ index }) => assignments[index]?.torrent.title || assignments[index]?.torrent.id || `#${index + 1}`)
      .slice(0, 3)
      .join("、");
    runtimeStore.showSnakebar(
      `批量预检失败，未发送任何任务；请检查 ${preflight.failures.length} 项配置` +
        (failedTitles ? `（${failedTitles}${preflight.failures.length > 3 ? "…" : ""}）` : ""),
      { color: "error" },
    );
    return {
      totalCount: assignments.length,
      successCount: 0,
      pendingCount: 0,
      failedCount: assignments.length,
    };
  }

  return await dispatchDownloadOptions(
    preflight.prepared.map(({ assignment, addTorrentOptions }) => ({
      torrent: assignment.torrent,
      downloaderId: assignment.downloaderId,
      addTorrentOptions,
    })),
  );
}

export function sendTorrentToDownloader(
  torrentItems: ITorrent[],
  downloaderId: TDownloaderKey,
  addTorrentOptions: CAddTorrentOptions,
): Promise<SendTorrentSummary> {
  return sendTorrentAssignments(
    torrentItems.map((torrent) => ({
      torrent,
      downloaderId,
      addTorrentOptions: { ...addTorrentOptions },
    })),
  );
}
