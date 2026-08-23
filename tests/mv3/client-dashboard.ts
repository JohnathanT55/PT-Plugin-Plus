import {
  filterSupportedClientDownloaders,
  isSupportedClientDownloader,
  normalizeClientRefreshInterval,
  summarizeClientOperationResults,
} from "../../app/src/entries/shared/clientDashboard";
import { toPlainSerializable } from "../../app/src/entries/shared/serializable";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Client dashboard test failed: ${message}`);
}

const downloaders = [
  { id: "qbit", type: "qBittorrent", enabled: true },
  { id: "tr", type: "Transmission", enabled: true },
  { id: "disabled-qbit", type: "qBittorrent", enabled: false },
  { id: "deluge", type: "Deluge", enabled: true },
];
const supported = filterSupportedClientDownloaders(downloaders);
assert(
  supported.map((downloader) => downloader.id).join(",") === "qbit,tr",
  "only enabled qBittorrent and Transmission clients are exposed",
);
assert(isSupportedClientDownloader(downloaders[0]), "enabled qBittorrent is supported");
assert(!isSupportedClientDownloader(downloaders[2]), "disabled clients are excluded");
assert(!isSupportedClientDownloader(downloaders[3]), "PTD-only downloader types are excluded");

assert(normalizeClientRefreshInterval(undefined) === 30, "missing intervals use the 30 second default");
assert(normalizeClientRefreshInterval(1) === 5, "short intervals are clamped to 5 seconds");
assert(normalizeClientRefreshInterval(34.6) === 35, "intervals are persisted as whole seconds");
assert(normalizeClientRefreshInterval(9000) === 3600, "long intervals are clamped to one hour");

const summary = summarizeClientOperationResults("pause", [
  { success: true, action: "pause", downloaderId: "qbit" },
  { success: false, action: "pause", downloaderId: "qbit", error: "token=secret-value" },
  {
    success: false,
    action: "pause",
    downloaderId: "tr",
    error: "request failed at https://tracker.example/download.php?passkey=secret-value",
  },
]);
assert(summary.successCount === 1 && summary.failedCount === 2, "batch results count partial success correctly");
assert(summary.downloaders.length === 2, "results are grouped per downloader");
const serializedErrors = JSON.stringify(summary.downloaders);
assert(!serializedErrors.includes("secret-value"), "summaries never expose credentials or tracker URLs");
assert(serializedErrors.includes("[redacted]"), "sanitized failures retain an actionable redaction marker");

class RuntimeDownloadOption {
  constructor(
    public title: string,
    public callback = () => "not cloneable",
  ) {}
}
const serializable = toPlainSerializable({
  torrent: new RuntimeDownloadOption("uploaded.torrent"),
  url: new URL("https://example.invalid/download"),
  bytes: 1n,
});
assert(serializable.torrent.title === "uploaded.torrent", "class-backed torrent data becomes a plain record");
assert(!("callback" in serializable.torrent), "function-valued runtime metadata is removed before IndexedDB");
assert(serializable.url === "https://example.invalid/download", "URL values retain their string representation");
assert(serializable.bytes === "1", "BigInt counters are persisted without DataCloneError");

console.log("Client dashboard tests passed.");
