import {
  MigrationMetadata,
  MV3_SCHEMA_VERSION,
  MV3State,
  VersionedEnvelope
} from "../model/schema";
import { assertValidMV3State } from "../model/validate";
import { migrateLegacyStorage } from "../migration/legacy";
import { upgradeStoredMV3State } from "../migration/state";
import { ChromeStorageAdapter } from "./adapter";
import {
  LEGACY_IMPORT_KEYS,
  MV3_DATA_STORAGE_KEYS,
  MV3_STORAGE_KEYS,
  revisionedStorageKey
} from "./keys";

function envelope<T>(
  data: T,
  now: number,
  revision: string
): VersionedEnvelope<T> {
  return {
    schemaVersion: MV3_SCHEMA_VERSION,
    storageRevision: revision,
    updatedAt: now,
    data
  };
}

function dataFromEnvelope<T>(
  value: any,
  key: string,
  schemaVersion: number,
  revision: string
): T {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Missing or invalid MV3 storage partition: " + key);
  }
  if (value.schemaVersion !== schemaVersion) {
    throw new Error("MV3 storage schema mismatch for partition: " + key);
  }
  if (value.storageRevision !== revision) {
    throw new Error("MV3 storage revision mismatch for partition: " + key);
  }
  if (!Object.prototype.hasOwnProperty.call(value, "data")) {
    throw new Error("MV3 storage partition has no data: " + key);
  }
  return value.data as T;
}

interface StoredMetadata {
  schemaVersion: number;
  revision: string;
  data: MigrationMetadata;
}

export class MV3Repository {
  private statePromise?: Promise<MV3State>;
  private revisionCounter = 0;

  constructor(
    private storage: ChromeStorageAdapter = new ChromeStorageAdapter(),
    private clock: () => number = () => Date.now()
  ) {}

  public initialize(): Promise<MV3State> {
    if (!this.statePromise) {
      this.statePromise = this.loadOrMigrate().catch(error => {
        this.statePromise = undefined;
        throw error;
      });
    }
    return this.statePromise;
  }

  public async reload(): Promise<MV3State> {
    this.statePromise = undefined;
    return this.initialize();
  }

  private createRevision(now: number): string {
    this.revisionCounter++;
    return (
      MV3_SCHEMA_VERSION +
      ":" +
      now.toString(36) +
      ":" +
      this.revisionCounter.toString(36) +
      ":" +
      Math.random()
        .toString(36)
        .slice(2)
    );
  }

  private readStoredMetadata(value: any): StoredMetadata {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Invalid MV3 metadata envelope");
    }
    if (typeof value.schemaVersion !== "number") {
      throw new Error("MV3 metadata has no schema version");
    }
    if (!value.storageRevision || typeof value.storageRevision !== "string") {
      throw new Error("MV3 metadata has no committed storage revision");
    }
    const metadata = dataFromEnvelope<MigrationMetadata>(
      value,
      MV3_STORAGE_KEYS.metadata,
      value.schemaVersion,
      value.storageRevision
    );
    if (
      !metadata ||
      typeof metadata !== "object" ||
      metadata.storageRevision !== value.storageRevision
    ) {
      throw new Error("MV3 metadata revision marker is inconsistent");
    }
    return {
      schemaVersion: value.schemaVersion,
      revision: value.storageRevision,
      data: metadata
    };
  }

  private async loadOrMigrate(): Promise<MV3State> {
    const metadataResult = await this.storage.get(MV3_STORAGE_KEYS.metadata);
    const metadataEnvelope = metadataResult[MV3_STORAGE_KEYS.metadata];
    if (typeof metadataEnvelope !== "undefined") {
      const storedMetadata = this.readStoredMetadata(metadataEnvelope);
      if (storedMetadata.schemaVersion > MV3_SCHEMA_VERSION) {
        throw new Error("Stored MV3 schema is newer than this extension build");
      }

      const storedState = await this.readRevision(storedMetadata);
      if (storedMetadata.schemaVersion === MV3_SCHEMA_VERSION) {
        const currentState = storedState as MV3State;
        assertValidMV3State(currentState);
        return currentState;
      }

      const upgraded = upgradeStoredMV3State(
        storedState,
        storedMetadata.schemaVersion,
        MV3_SCHEMA_VERSION,
        this.clock()
      );
      assertValidMV3State(upgraded);
      await this.writeState(upgraded);
      return upgraded;
    }

    const legacy = await this.storage.get(LEGACY_IMPORT_KEYS);
    const migrated = migrateLegacyStorage(legacy, this.clock());
    migrated.state.metadata.migratedCounts = migrated.migratedCounts;
    assertValidMV3State(migrated.state);
    await this.writeState(migrated.state);
    return migrated.state;
  }

  private async readRevision(metadata: StoredMetadata): Promise<any> {
    const keyFor = (baseKey: string) =>
      revisionedStorageKey(baseKey, metadata.revision);
    const revisionedKeys = MV3_DATA_STORAGE_KEYS.map(keyFor);
    const values = await this.storage.get(revisionedKeys);
    const read = <T>(baseKey: string): T => {
      const storageKey = keyFor(baseKey);
      return dataFromEnvelope<T>(
        values[storageKey],
        baseKey,
        metadata.schemaVersion,
        metadata.revision
      );
    };

    return {
      metadata: metadata.data,
      settings: read(MV3_STORAGE_KEYS.settings),
      sites: read(MV3_STORAGE_KEYS.sites),
      hostToSiteId: read(MV3_STORAGE_KEYS.hostToSiteId),
      downloaders: read(MV3_STORAGE_KEYS.downloaders),
      siteDownloadProfiles: read(MV3_STORAGE_KEYS.siteDownloadProfiles),
      backupServers: read(MV3_STORAGE_KEYS.backupServers),
      userHistory: read(MV3_STORAGE_KEYS.userHistory),
      downloadHistory: read(MV3_STORAGE_KEYS.downloadHistory),
      collections: read(MV3_STORAGE_KEYS.collections),
      searchSnapshots: read(MV3_STORAGE_KEYS.searchSnapshots),
      keepUploadTasks: read(MV3_STORAGE_KEYS.keepUploadTasks),
      uiOptions: read(MV3_STORAGE_KEYS.uiOptions),
      systemLogs: read(MV3_STORAGE_KEYS.systemLogs)
    };
  }

  public async readState(): Promise<MV3State> {
    const metadataResult = await this.storage.get(MV3_STORAGE_KEYS.metadata);
    const storedMetadata = this.readStoredMetadata(
      metadataResult[MV3_STORAGE_KEYS.metadata]
    );
    if (storedMetadata.schemaVersion !== MV3_SCHEMA_VERSION) {
      throw new Error("Stored MV3 state must be upgraded before it can be read");
    }
    const state = (await this.readRevision(storedMetadata)) as MV3State;
    assertValidMV3State(state);
    return state;
  }

  public async writeState(state: MV3State): Promise<void> {
    const now = this.clock();
    const revision = this.createRevision(now);
    const previousRevision = state.metadata.storageRevision;
    const obsoleteRevision = state.metadata.previousStorageRevision;
    state.metadata.schemaVersion = MV3_SCHEMA_VERSION;
    state.metadata.updatedAt = now;
    state.metadata.previousStorageRevision = previousRevision;
    state.metadata.storageRevision = revision;
    assertValidMV3State(state);

    const byBaseKey: { [baseKey: string]: any } = {};
    byBaseKey[MV3_STORAGE_KEYS.settings] = state.settings;
    byBaseKey[MV3_STORAGE_KEYS.sites] = state.sites;
    byBaseKey[MV3_STORAGE_KEYS.hostToSiteId] = state.hostToSiteId;
    byBaseKey[MV3_STORAGE_KEYS.downloaders] = state.downloaders;
    byBaseKey[MV3_STORAGE_KEYS.siteDownloadProfiles] =
      state.siteDownloadProfiles;
    byBaseKey[MV3_STORAGE_KEYS.backupServers] = state.backupServers;
    byBaseKey[MV3_STORAGE_KEYS.userHistory] = state.userHistory;
    byBaseKey[MV3_STORAGE_KEYS.downloadHistory] = state.downloadHistory;
    byBaseKey[MV3_STORAGE_KEYS.collections] = state.collections;
    byBaseKey[MV3_STORAGE_KEYS.searchSnapshots] = state.searchSnapshots;
    byBaseKey[MV3_STORAGE_KEYS.keepUploadTasks] = state.keepUploadTasks;
    byBaseKey[MV3_STORAGE_KEYS.uiOptions] = state.uiOptions;
    byBaseKey[MV3_STORAGE_KEYS.systemLogs] = state.systemLogs;

    const staged: { [storageKey: string]: any } = {};
    MV3_DATA_STORAGE_KEYS.forEach(baseKey => {
      staged[revisionedStorageKey(baseKey, revision)] = envelope(
        byBaseKey[baseKey],
        now,
        revision
      );
    });

    // Each revision is immutable. If the worker is terminated before the
    // metadata commit, the previous revision remains complete and readable.
    await this.storage.set(staged);
    const verification = await this.storage.get(Object.keys(staged));
    MV3_DATA_STORAGE_KEYS.forEach(baseKey => {
      const storageKey = revisionedStorageKey(baseKey, revision);
      dataFromEnvelope(
        verification[storageKey],
        baseKey,
        MV3_SCHEMA_VERSION,
        revision
      );
    });

    await this.storage.set({
      [MV3_STORAGE_KEYS.metadata]: envelope(state.metadata, now, revision)
    });

    // Retain the current and immediately previous immutable generation. Older
    // generations are safe to remove only after the new metadata marker commits.
    if (
      obsoleteRevision &&
      obsoleteRevision !== revision &&
      obsoleteRevision !== previousRevision
    ) {
      const obsoleteKeys = MV3_DATA_STORAGE_KEYS.map(baseKey =>
        revisionedStorageKey(baseKey, obsoleteRevision)
      );
      try {
        await this.storage.remove(obsoleteKeys);
      } catch (_error) {
        // A cleanup failure is non-fatal; the committed revision remains valid.
      }
    }
  }
}
