import type { ITorrent } from "@ptd/site";

import type { TDownloadSizeUnit } from "./types.ts";

const UNIT_EXPONENT: Record<TDownloadSizeUnit, number> = {
  KiB: 1,
  MiB: 2,
  GiB: 3,
  TiB: 4,
  PiB: 5,
  EiB: 6,
  ZiB: 7,
};

export function downloadSizeThresholdBytes(value: number, unit: TDownloadSizeUnit): number {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  return safeValue * 1024 ** UNIT_EXPONENT[unit];
}

export function batchTorrentSizeBytes(torrents: readonly Partial<ITorrent>[]): number {
  return torrents.reduce((total, torrent) => {
    const size = Number(torrent.size ?? 0);
    return total + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
}

export function shouldConfirmBatchSize(
  torrents: readonly Partial<ITorrent>[],
  enabled: boolean,
  value: number,
  unit: TDownloadSizeUnit,
): boolean {
  if (!enabled || torrents.length === 0) return false;
  const threshold = downloadSizeThresholdBytes(value, unit);
  return threshold > 0 && batchTorrentSizeBytes(torrents) > threshold;
}

export async function executeSerialBatch<T, TResult>(
  items: readonly T[],
  execute: (item: T, index: number) => Promise<TResult> | TResult,
  intervalMs: number,
  delay: (milliseconds: number) => Promise<void> = (milliseconds) =>
    new Promise((resolve) => setTimeout(resolve, milliseconds)),
): Promise<TResult[]> {
  const results: TResult[] = [];
  const safeInterval = Number.isFinite(intervalMs) ? Math.max(0, intervalMs) : 0;
  for (let index = 0; index < items.length; index += 1) {
    results.push(await execute(items[index], index));
    if (safeInterval > 0 && index < items.length - 1) await delay(safeInterval);
  }
  return results;
}
