import { Dictionary, MV3State } from "../model/schema";

export type StoredStateMigration = (state: any, now: number) => any;

/**
 * Register every released schema transition here before incrementing
 * MV3_SCHEMA_VERSION. Missing transitions fail closed instead of re-importing
 * the older MV2 snapshot and overwriting newer MV3 data.
 */
const STATE_MIGRATIONS: Dictionary<StoredStateMigration> = {};

export function upgradeStoredMV3State(
  storedState: any,
  fromVersion: number,
  toVersion: number,
  now: number
): MV3State {
  let state = storedState;
  let version = fromVersion;
  while (version < toVersion) {
    const migration = STATE_MIGRATIONS[String(version)];
    if (!migration) {
      throw new Error(
        "No MV3 state migration registered for schema v" +
          version +
          " to v" +
          (version + 1)
      );
    }
    state = migration(state, now);
    version++;
  }
  if (!state || !state.metadata) {
    throw new Error("MV3 state migration returned an invalid state");
  }
  state.metadata.schemaVersion = toVersion;
  state.metadata.updatedAt = now;
  return state as MV3State;
}
