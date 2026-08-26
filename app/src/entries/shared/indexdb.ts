import { openDB, type IDBPDatabase } from "idb";

import type { IPtdDBSchema, IPtdDBSchemaV1, IPtdDBSchemaV2, IPtdDBSchemaV3 } from "./types.ts";

let databasePromise: ReturnType<typeof openDB<IPtdDBSchema>> | undefined;

export function getPtdIndexDb() {
  databasePromise ??= openDB<IPtdDBSchema>("ptd", 4, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const dbV1 = db as unknown as IDBPDatabase<IPtdDBSchemaV1>;
        dbV1.createObjectStore("social_information");
      }
      if (oldVersion < 2) {
        const dbV2 = db as unknown as IDBPDatabase<IPtdDBSchemaV2>;
        dbV2.createObjectStore("download_history", { keyPath: "id", autoIncrement: true });
      }
      if (oldVersion < 3) {
        const dbV3 = db as unknown as IDBPDatabase<IPtdDBSchemaV3>;
        dbV3.createObjectStore("favicon");
      }
      if (oldVersion < 4) {
        db.createObjectStore("movie_entity");
        db.createObjectStore("movie_alias");
      }
    },
  });
  return databasePromise;
}
