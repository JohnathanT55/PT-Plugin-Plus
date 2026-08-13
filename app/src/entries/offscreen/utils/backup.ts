import { intersection } from "es-toolkit";
import { formatDate } from "date-fns";
import { getBackupServer, IBackupData, IBackupFileInfo } from "@ptd/backupServer";
import { backupDataToJSZipBlob } from "@ptd/backupServer/utils.ts";
import AbstractBackupServer from "@ptd/backupServer/AbstractBackupServer.ts";

import { onMessage, sendMessage } from "@/messages.ts";
import type { IExtensionStorageSchema, TExtensionStorageKey } from "@/storage.ts";
import type {
  IRestoreOptions,
  IMetadataPiniaStorageSchema,
  TBackupFields,
  TBackupServerKey,
  IConfigPiniaStorageSchema,
  TUserInfoStorageSchema,
  TSearchResultSnapshotStorageSchema,
  TKeepUploadTaskStorageSchema,
} from "@/shared/types.ts";

import { logger } from "./logger.ts";
import { ptdIndexDb } from "../adapter/indexdb.ts";
import {
  getEffectiveBackupEncryptionKey,
  normalizeBackupFields,
  prepareConfigForBackup,
} from "@foundation/backup/policy";
import { extendCookieExpiration, latestRecordsFromHistory, mergeRestoredRecords } from "@foundation/backup/restore";
import { BackupFields } from "@/shared/types.ts";

export const storageKey = [
  "config",
  "metadata",
  "userInfo",
  "searchResultSnapshot",
  "keepUploadTask",
] as TExtensionStorageKey[];

export async function createBackupData(backupFields: TBackupFields[] = []): Promise<IBackupData> {
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;

  const backupData: IBackupData = {};

  // 备份已添加站点的Cookie
  if (backupFields.includes("cookies")) {
    const cookies = {} as Required<IBackupData>["cookies"];
    for (const siteHost in metadataStore.siteHostMap) {
      const siteHostCookies = await sendMessage("getAllCookies", { domain: siteHost });
      if (siteHostCookies.length > 0) {
        cookies[siteHost] = siteHostCookies;
      }
    }
    backupData.cookies = cookies;
  }

  // 处理直接从 chrome.storage.local 读取的字段
  for (const field of storageKey) {
    if (backupFields.includes(field as TBackupFields)) {
      const fieldData = await sendMessage("getExtStorage", field);
      backupData[field] =
        field === "config" ? prepareConfigForBackup(fieldData as IConfigPiniaStorageSchema) : fieldData;
    }
  }

  // 备份下载历史
  if (backupFields.includes("downloadHistory")) {
    backupData["downloadHistory"] = await (await ptdIndexDb).getAll("download_history");
  }

  // 收藏使用版本化兼容仓库，由 service worker 负责读写。
  if (backupFields.includes("collection")) {
    backupData["collection"] = await sendMessage("getPtppCollectionState", undefined);
  }

  backupData.manifest = {
    time: new Date().getTime(),
    version: `PT-Plugin-Plus MV3 (${__EXT_VERSION__})`,
  };

  logger({
    msg: `A Backup data created at ${formatDate(backupData.manifest.time!, "yyyy-MM-dd HH:mm:ss")}`,
    data: Object.keys(backupData),
  });
  return backupData;
}

export async function getBackupServerInstance(backupServerId: TBackupServerKey): Promise<AbstractBackupServer<any>> {
  logger({ msg: `Get backup server instance for ID: ${backupServerId}` });
  const metadataStore = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
  const backupServerConfig = metadataStore.backupServers[backupServerId];
  return await getBackupServer(backupServerConfig);
}

export async function exportBackupData(
  backupServerId: string | "local",
  backupFields: TBackupFields[] = [],
): Promise<boolean> {
  const backupData = await createBackupData(backupFields);
  const backupFilename = `PTPP_backup_${formatDate(new Date(), "yyyyMMdd'T'HHmmssSSS")}.zip`;

  const configStore = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema;
  const encryptionKey = getEffectiveBackupEncryptionKey(
    configStore?.backup?.encryptionEnabled,
    configStore?.backup?.encryptionKey,
  );

  logger({ msg: `Exporting backup data to ${backupServerId}`, data: { backupFields, backupFilename } });
  if (backupServerId === "local") {
    const jsZipBlob = await backupDataToJSZipBlob(backupData, encryptionKey);
    const blobUrl = URL.createObjectURL(jsZipBlob);
    await sendMessage("downloadFile", { url: blobUrl, filename: backupFilename, conflictAction: "uniquify" });
    return true;
  } else {
    const backupServerInstance = await getBackupServerInstance(backupServerId);
    backupServerInstance.setEncryptionKey(encryptionKey);
    return await backupServerInstance.addFile(backupFilename, backupData);
  }
}

onMessage("exportBackupData", async ({ data: { backupServerId, backupFields } }) => {
  return await exportBackupData(backupServerId, backupFields);
});

export async function restoreBackupData(
  restoreData: IBackupData, // 已经解密了的数据
  restoreOptions: IRestoreOptions = {},
): Promise<boolean> {
  const { fields = [], expandCookieMinutes = -1, keepExistUserInfo = true } = restoreOptions;

  const restoreDataExistFields = Object.keys(restoreData.manifest?.files ?? {});
  const restoreFields = intersection(fields, restoreDataExistFields);

  // 恢复下载历史
  if (restoreFields.includes("downloadHistory")) {
    const db = await ptdIndexDb;
    await db.clear("download_history");
    for (const downloadHistoryElement of restoreData.downloadHistory) {
      await db.put("download_history", downloadHistoryElement);
    }
  }

  if (restoreFields.includes("collection") && restoreData.collection) {
    await sendMessage("replacePtppCollectionState", restoreData.collection);
  }

  // 恢复直接从 chrome.storage.local 读取的字段
  for (const field of storageKey.toReversed()) {
    if (restoreFields.includes(field as TBackupFields)) {
      let fieldData = restoreData[field] as IExtensionStorageSchema[typeof field];
      if (fieldData) {
        if (field === "config") {
          const configData = fieldData as IConfigPiniaStorageSchema;
          const currentConfig = (await sendMessage("getExtStorage", "config")) as IConfigPiniaStorageSchema | undefined;
          configData.backup ??= {
            encryptionKey: "",
            encryptionEnabled: false,
            enabledAutoBackup: false,
            autoUploadUserData: { enabled: false, serverId: "" },
            retry: { max: 3, interval: 5 },
          };
          // The key is a local recovery secret and is intentionally not part of backups.
          // Restoring configuration must therefore keep the current browser's encryption settings.
          configData.backup.encryptionKey = currentConfig?.backup?.encryptionKey ?? "";
          configData.backup.encryptionEnabled = currentConfig?.backup?.encryptionEnabled ?? false;
          configData.backup.autoUploadUserData ??= { enabled: false, serverId: "" };
          configData.backup.retry ??= { max: 3, interval: 5 };
        }
        if (field === "metadata") {
          const metadataData = fieldData as IMetadataPiniaStorageSchema;
          for (const server of Object.values(metadataData.backupServers ?? {})) {
            const normalized = normalizeBackupFields(server.backupFields, server.backupFieldsVersion, BackupFields);
            server.backupFields = normalized.fields as typeof server.backupFields;
            server.backupFieldsVersion = normalized.version;
          }
        }
        if (field === "userInfo" && keepExistUserInfo) {
          const userInfoStore = ((await sendMessage("getExtStorage", "userInfo")) ?? {}) as TUserInfoStorageSchema;
          fieldData = mergeRestoredRecords(
            fieldData as unknown as Record<string, unknown>,
            userInfoStore as unknown as Record<string, unknown>,
            true,
          ) as TUserInfoStorageSchema;
        }

        await sendMessage("setExtStorage", { key: field, value: fieldData });
        if (field === "userInfo" && !keepExistUserInfo && !restoreFields.includes("metadata")) {
          const metadataData = (await sendMessage("getExtStorage", "metadata")) as IMetadataPiniaStorageSchema;
          metadataData.lastUserInfo = latestRecordsFromHistory(fieldData as TUserInfoStorageSchema);
          await sendMessage("setExtStorage", { key: "metadata", value: metadataData });
        }
      }
    }
  }

  // 恢复已添加站点的Cookie
  if (restoreFields.includes("cookies")) {
    const now = new Date().getTime() / 1000;

    for (const cookieData of Object.values(restoreData.cookies!)) {
      for (const cookie of cookieData) {
        // 延长 cookie 过期时间
        cookie.expirationDate = extendCookieExpiration(cookie.expirationDate, expandCookieMinutes, now);

        await sendMessage("setCookie", cookie as unknown as chrome.cookies.SetDetails);
      }
    }
  }

  return true;
}

onMessage("restoreBackupData", async ({ data: { restoreData, restoreOptions = {} } }) => {
  return await restoreBackupData(restoreData, restoreOptions);
});

export async function getBackupHistory(backupServerId: string): Promise<IBackupFileInfo[]> {
  const backupServerInstance = await getBackupServerInstance(backupServerId);
  return await backupServerInstance.list();
}

onMessage("getBackupHistory", async ({ data: backupServerId }) => {
  return await getBackupHistory(backupServerId);
});

export async function deleteBackupHistory(backupServerId: string, path: string): Promise<boolean> {
  const backupServerInstance = await getBackupServerInstance(backupServerId);
  return await backupServerInstance.deleteFile(path);
}

onMessage("deleteBackupHistory", async ({ data: { backupServerId, path } }) => {
  return await deleteBackupHistory(backupServerId, path);
});

export async function getRemoteBackupData(
  backupServerId: string,
  path: string,
  decryptKey: string = "",
): Promise<IBackupData> {
  const backupServerInstance = await getBackupServerInstance(backupServerId);
  backupServerInstance.setEncryptionKey(decryptKey);
  return await backupServerInstance.getFile(path);
}

onMessage("getRemoteBackupData", async ({ data: { backupServerId, path, decryptKey = "" } }) => {
  return await getRemoteBackupData(backupServerId, path, decryptKey);
});
