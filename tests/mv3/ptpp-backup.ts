import CryptoJS from "crypto-js";
import JSZip from "jszip";

import { parsePtppBackup } from "../../app/src/entries/shared/ptppBackup.ts";
import { LEGACY_STORAGE_KEYS } from "../../src/storage/keys.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PTPP backup parser test failed: ${message}`);
}

function checkInfo(raw: string) {
  const keyMap = Array.from({ length: 32 }, (_, index) => index % raw.length);
  return {
    keyMap,
    length: raw.length,
    hash: CryptoJS.MD5(keyMap.map((index) => raw.substring(index, index + 1)).join("")).toString(),
  };
}

async function buildLegacyBackup(encryptionKey = "") {
  const options = JSON.stringify({
    sites: [{ host: "audiences.me", name: "Audiences", url: "https://audiences.me/" }],
    clients: [{ id: "client-1", name: "Fixture", type: "qBittorrent", address: "http://127.0.0.1:8080" }],
  });
  const userdatas = JSON.stringify({
    "audiences.me": { latest: { name: "fixture", uploaded: 1024, downloaded: 512 } },
  });
  const encrypted = Boolean(encryptionKey);
  const encode = (raw: string) => (encrypted ? CryptoJS.AES.encrypt(raw, encryptionKey).toString() : raw);
  const encodedOptions = encode(options);
  const encodedUserdatas = encode(userdatas);
  const zip = new JSZip();
  zip.file("options.json", encodedOptions);
  zip.file("userdatas.json", encodedUserdatas);
  zip.file("collection.json", encode(JSON.stringify({ groups: [], items: [] })));
  zip.file("cookies.json", encode(JSON.stringify([{ url: "https://audiences.me/", cookies: [] }])));
  zip.file(
    "manifest.json",
    JSON.stringify({
      version: "v1.6.1.2721",
      time: 123456,
      encryptMode: encrypted ? "AES" : "",
      checkInfo: checkInfo(encodedOptions + encodedUserdatas),
    }),
  );
  return await zip.generateAsync({ type: "nodebuffer" });
}

for (const encryptionKey of ["", "fixture-key"]) {
  const parsed = await parsePtppBackup((await buildLegacyBackup(encryptionKey)) as unknown as Blob, encryptionKey);
  assert(parsed.manifest.version === "v1.6.1.2721", "legacy manifest is recognized");
  assert(parsed.availableFields.includes("metadata"), "site/downloader metadata is offered for import");
  assert(parsed.availableFields.includes("userInfo"), "user history is offered for import");
  assert(parsed.hasCollections, "collections are retained in compatibility state");
  assert(LEGACY_STORAGE_KEYS.config in parsed.payload.legacy, "options.json maps to the legacy config key");
  assert(LEGACY_STORAGE_KEYS.userHistory in parsed.payload.legacy, "userdatas.json maps to the history key");
}

console.log("PTPP backup parser tests passed");
