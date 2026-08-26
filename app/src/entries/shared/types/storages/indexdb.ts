/**
 * 存放一些不需要持久化（丢失没有关系的）的结构性数据，包括：
 * 1. 种子列表页面的多媒体数据
 * 2. 种子下载记录
 */

import type { DBSchema } from "idb";
import type { IMovieEntityCacheRecord, ISocialInformation } from "@ptd/social";
import type { TSiteID as TSiteKey } from "@ptd/site";

import type { ITorrentDownloadMetadata, TTorrentDownloadKey } from "../common/download.ts";

export interface IPtdDBSchemaV1 extends DBSchema {
  social_information: {
    key: string;
    value: ISocialInformation;
  };
}

export interface IPtdDBSchemaV2 extends IPtdDBSchemaV1 {
  download_history: {
    key: TTorrentDownloadKey;
    value: ITorrentDownloadMetadata;
  };
}

export interface IPtdDBSchemaV3 extends IPtdDBSchemaV2 {
  favicon: {
    key: TSiteKey;
    value: string;
  };
}

export interface IPtdDBSchema extends IPtdDBSchemaV3 {
  movie_entity: {
    key: string;
    value: IMovieEntityCacheRecord;
  };
  movie_alias: {
    key: string;
    value: string;
  };
}
