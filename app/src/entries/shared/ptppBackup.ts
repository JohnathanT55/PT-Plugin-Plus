import CryptoJS from "crypto-js";
import JSZip from "jszip";

import { LEGACY_STORAGE_KEYS } from "@foundation/storage/keys";
import type { TBackupFields } from "@/shared/types.ts";
import type { IPtppLegacyBackupImportPayload, IPtppLegacyCookieGroup } from "@/shared/types.ts";

interface IPtppBackupManifest {
  version?: string;
  time?: number;
  encryptMode?: string;
  checkInfo?: {
    hash?: string;
    keyMap?: number[];
    length?: number;
  };
}

export interface IParsedPtppBackup {
  manifest: IPtppBackupManifest;
  payload: Omit<IPtppLegacyBackupImportPayload, "fields" | "expandCookieMinutes" | "keepExistUserInfo">;
  availableFields: TBackupFields[];
  hasCollections: boolean;
}

function parseJson<T>(raw: string, encryptionKey: string, encrypted: boolean, fileName: string): T {
  try {
    const plainText = encrypted ? CryptoJS.AES.decrypt(raw, encryptionKey).toString(CryptoJS.enc.Utf8) : raw;
    if (!plainText) throw new Error("empty decrypted content");
    return JSON.parse(plainText) as T;
  } catch {
    throw new Error(`Unable to read ${fileName}; the file may be damaged or the decryption key is incorrect.`);
  }
}

function validateLegacyHash(manifest: IPtppBackupManifest, rawContent: string): void {
  const checkInfo = manifest.checkInfo;
  if (!checkInfo || checkInfo.length !== rawContent.length || checkInfo.keyMap?.length !== 32) {
    throw new Error("Invalid PT-Plugin-Plus backup integrity metadata.");
  }
  const checkText = checkInfo.keyMap.map((index) => rawContent.substring(index, index + 1)).join("");
  if (CryptoJS.MD5(checkText).toString() !== checkInfo.hash) {
    throw new Error("PT-Plugin-Plus backup integrity check failed.");
  }
}

async function readRequired(zip: JSZip, name: string): Promise<string> {
  const entry = zip.file(name);
  if (!entry) throw new Error(`Missing ${name} in PT-Plugin-Plus backup.`);
  return await entry.async("string");
}

async function readOptional(zip: JSZip, name: string): Promise<string | undefined> {
  return await zip.file(name)?.async("string");
}

export async function parsePtppBackup(blob: Blob, encryptionKey = ""): Promise<IParsedPtppBackup> {
  const zip = await JSZip.loadAsync(blob);
  const manifestRaw = await readRequired(zip, "manifest.json");
  const manifest = JSON.parse(manifestRaw) as IPtppBackupManifest;
  if (manifest && typeof (manifest as { files?: unknown }).files !== "undefined") {
    throw new Error("This is a PT-Plugin-Plus MV3 backup, not a legacy backup.");
  }

  const optionsRaw = await readRequired(zip, "options.json");
  const userDataRaw = await readRequired(zip, "userdatas.json");
  validateLegacyHash(manifest, optionsRaw + userDataRaw);

  const encrypted = Boolean(manifest.encryptMode);
  if (encrypted && !encryptionKey) {
    throw new Error("This PT-Plugin-Plus backup requires its legacy encryption key.");
  }

  const legacy: Record<string, unknown> = {
    [LEGACY_STORAGE_KEYS.config]: parseJson(optionsRaw, encryptionKey, encrypted, "options.json"),
    [LEGACY_STORAGE_KEYS.userHistory]: parseJson(userDataRaw, encryptionKey, encrypted, "userdatas.json"),
  };
  const availableFields = ["config", "metadata", "userInfo"] as TBackupFields[];

  const optionalMappings: Array<[string, string, TBackupFields]> = [
    ["collection.json", LEGACY_STORAGE_KEYS.collections, "collection"],
    ["searchResultSnapshot.json", LEGACY_STORAGE_KEYS.searchSnapshots, "searchResultSnapshot"],
    ["keepUploadTask.json", LEGACY_STORAGE_KEYS.keepUploadTasks, "keepUploadTask"],
    ["downloadHistory.json", LEGACY_STORAGE_KEYS.downloadHistory, "downloadHistory"],
  ];
  for (const [fileName, storageKey, field] of optionalMappings) {
    const raw = await readOptional(zip, fileName);
    if (typeof raw === "undefined") continue;
    legacy[storageKey] = parseJson(raw, encryptionKey, encrypted, fileName);
    if (!availableFields.includes(field)) availableFields.push(field);
  }

  let cookies: IPtppLegacyCookieGroup[] = [];
  const cookiesRaw = await readOptional(zip, "cookies.json");
  if (typeof cookiesRaw !== "undefined") {
    const parsedCookies = parseJson<unknown>(cookiesRaw, encryptionKey, encrypted, "cookies.json");
    if (Array.isArray(parsedCookies)) {
      cookies = parsedCookies.filter(
        (item): item is IPtppLegacyCookieGroup =>
          Boolean(item) &&
          typeof item === "object" &&
          typeof (item as IPtppLegacyCookieGroup).url === "string" &&
          Array.isArray((item as IPtppLegacyCookieGroup).cookies),
      );
      if (cookies.length > 0) availableFields.unshift("cookies");
    }
  }

  const sourceRevision = `ptpp-backup:${manifest.time ?? 0}:${manifest.checkInfo?.hash ?? "unknown"}`;
  return {
    manifest,
    payload: { legacy, cookies, sourceRevision },
    availableFields,
    hasCollections: Object.prototype.hasOwnProperty.call(legacy, LEGACY_STORAGE_KEYS.collections),
  };
}
