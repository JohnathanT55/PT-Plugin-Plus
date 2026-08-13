import {
  batchTorrentSizeBytes,
  downloadSizeThresholdBytes,
  executeSerialBatch,
  shouldConfirmBatchSize,
} from "../../app/src/entries/shared/downloadBatchPolicy";
import {
  getParsedTorrentInfoForVerification,
  type ParsedTorrent,
} from "../../app/src/packages/downloader/utils";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`Download policy test failed: ${message}`);
}

assert(downloadSizeThresholdBytes(10, "GiB") === 10 * 1024 ** 3, "10 GiB uses binary units");
assert(
  batchTorrentSizeBytes([{ size: 6 * 1024 ** 3 }, { size: 5 * 1024 ** 3 }]) === 11 * 1024 ** 3,
  "batch size sums every selected torrent",
);
assert(
  shouldConfirmBatchSize([{ size: 6 * 1024 ** 3 }, { size: 5 * 1024 ** 3 }], true, 10, "GiB"),
  "a batch above the legacy 10 GiB threshold requires confirmation",
);
assert(
  !shouldConfirmBatchSize([{ size: 10 * 1024 ** 3 }], true, 10, "GiB"),
  "a batch exactly at the threshold does not require confirmation",
);
assert(
  !shouldConfirmBatchSize([{ size: 20 * 1024 ** 3 }], false, 10, "GiB"),
  "disabled confirmation never blocks a batch",
);

const events: string[] = [];
const results = await executeSerialBatch(
  ["a", "b", "c"],
  async (item) => {
    events.push(`run:${item}`);
    return item.toUpperCase();
  },
  5000,
  async (milliseconds) => events.push(`wait:${milliseconds}`),
);
assert(results.join("") === "ABC", "serial execution returns ordered results");
assert(
  events.join("|") === "run:a|wait:5000|run:b|wait:5000|run:c",
  "the configured interval runs only between completed items",
);

const parsedTorrent = {
  info: {
    infoHash: "0123456789abcdef0123456789abcdef01234567",
    name: "verification-fixture",
    length: 12345,
    files: [{ path: "verification-fixture/file.mkv", length: 12345 }],
  },
} as unknown as ParsedTorrent;
const verificationInfo = getParsedTorrentInfoForVerification(parsedTorrent);
assert(
  verificationInfo.infoHash === "0123456789abcdef0123456789abcdef01234567",
  "torrent verification reads infoHash from the nested parse-torrent result",
);
assert(verificationInfo.name === "verification-fixture", "torrent verification preserves the parsed name");
assert(verificationInfo.length === 12345, "torrent verification preserves the parsed total size");
assert(
  verificationInfo.files.length === 1 && verificationInfo.files[0].path === "verification-fixture/file.mkv",
  "torrent verification returns serializable file metadata",
);

console.log("PTPP download policy, torrent verification and serial interval tests passed.");
