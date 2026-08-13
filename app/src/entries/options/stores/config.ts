/**
 * 所有和 ui 相关的选项均在本 store 管理
 */
import { defineStore } from "pinia";
import { has, unset } from "es-toolkit/compat";
import { usePreferredDark } from "@vueuse/core";

import type { IConfigPiniaStorageSchema, supportThemeType, ToolbarDockSide } from "@/shared/types.ts";
import {
  DEFAULT_TOOLBAR_EDGE_OFFSET,
  normalizeToolbarPlacement,
  TOOLBAR_POSITION_VERSION,
  type ToolbarCoordinates,
  type ToolbarPlacement,
} from "@/shared/toolbarPosition.ts";

import { useMetadataStore } from "./metadata.ts";

const deprecatedConfigKeys = [
  "myDataTableControl.tableFontSize", // v0.0.4.961 废弃
  "myDataTableControl.joinTimeWeekOnly", // 已废弃，使用 joinTimeFormat 替代
];

export const defaultTimelineBackgroundColor = "#455A64";

export const useConfigStore = defineStore("config", {
  persistWebExt: {
    afterRestore: (context) => {
      // 清理已废弃的配置项
      const state = context.store.$state as any;
      let needsSave = false;

      // 清理已废弃的配置项
      for (const key of deprecatedConfigKeys) {
        if (has(state, key)) {
          unset(state, key);
          needsSave = true;
        }
      }

      // 清理基于 id 字段的 DownloadHistory 排序配置
      if (state.tableBehavior?.DownloadHistory?.sortBy) {
        const sortBy = state.tableBehavior.DownloadHistory.sortBy;
        // 过滤掉基于 id 字段的排序项
        const filteredSortBy = sortBy.filter((sort: any) => sort.key !== "id");

        // 如果过滤后数组长度发生变化，说明移除了基于 id 的排序项
        if (filteredSortBy.length !== sortBy.length) {
          // 如果过滤后没有任何排序项，使用默认的 downloadAt 排序
          if (filteredSortBy.length === 0) {
            state.tableBehavior.DownloadHistory.sortBy = [{ key: "downloadAt", order: "desc" }];
          } else {
            // 否则保留其他有效的排序项
            state.tableBehavior.DownloadHistory.sortBy = filteredSortBy;
          }
          needsSave = true;
        }
      }

      // Rich search rows create favicons, tags, action controls and optional
      // social metadata. Old persisted values of 100/All can make the options
      // page unresponsive, so migrate them to the largest supported page.
      const searchItemsPerPage = state.tableBehavior?.SearchEntity?.itemsPerPage;
      if (state.tableBehavior?.SearchEntity && ![10, 25, 50].includes(searchItemsPerPage)) {
        state.tableBehavior.SearchEntity.itemsPerPage = 50;
        needsSave = true;
      }

      // PTPP v1 stored these download settings at the config root. Preserve
      // them when an old backup is restored into the MV3 nested config store.
      state.download ??= {};
      const legacyDownloadKeys = [
        "downloadFailedRetry",
        "downloadFailedFailedRetryCount",
        "downloadFailedFailedRetryInterval",
        "batchDownloadInterval",
        "enableBackgroundDownload",
        "needConfirmWhenExceedSize",
        "exceedSize",
        "exceedSizeUnit",
      ];
      for (const key of legacyDownloadKeys) {
        if (Object.hasOwn(state, key)) {
          state.download[key] = state[key];
          delete state[key];
          needsSave = true;
        }
      }

      const validSizeUnits = new Set(["KiB", "MiB", "GiB", "TiB", "PiB", "EiB", "ZiB"]);
      if (!validSizeUnits.has(state.download.exceedSizeUnit)) {
        state.download.exceedSizeUnit = "GiB";
        needsSave = true;
      }

      state.backup ??= {};
      if (typeof state.backup.encryptionEnabled !== "boolean") {
        // Preserve the old PTD behavior where a non-empty key implicitly enabled encryption.
        state.backup.encryptionEnabled = Boolean(state.backup.encryptionKey?.trim());
        needsSave = true;
      }
      if (!state.backup.autoUploadUserData) {
        state.backup.autoUploadUserData = {
          enabled: state.autoBackupData === true,
          serverId: typeof state.autoBackupDataServerId === "string" ? state.autoBackupDataServerId : "",
        };
        needsSave = true;
      }
      if (!state.backup.retry) {
        state.backup.retry = { max: 3, interval: 5 };
        needsSave = true;
      }
      for (const key of ["autoBackupData", "autoBackupDataServerId"]) {
        if (Object.hasOwn(state, key)) {
          delete state[key];
          needsSave = true;
        }
      }

      state.searchEntity ??= {};
      const legacyBeforeSearching = state.beforeSearchingOptions;
      if (legacyBeforeSearching && typeof legacyBeforeSearching === "object") {
        if (typeof legacyBeforeSearching.getMovieInformation === "boolean") {
          state.searchEntity.movieSuggestionEnabled = legacyBeforeSearching.getMovieInformation;
        }
        if (Number.isFinite(legacyBeforeSearching.maxMovieInformationCount)) {
          state.searchEntity.movieSuggestionCount = legacyBeforeSearching.maxMovieInformationCount;
        }
        if (["id", "name"].includes(legacyBeforeSearching.searchModeForItem)) {
          state.searchEntity.movieSuggestionSearchMode =
            legacyBeforeSearching.searchModeForItem === "name" ? "title" : "id";
        }
        delete state.beforeSearchingOptions;
        needsSave = true;
      }
      if (typeof state.searchEntity.movieSuggestionEnabled !== "boolean") {
        state.searchEntity.movieSuggestionEnabled = true;
        needsSave = true;
      }
      const suggestionCount = Math.min(10, Math.max(1, Math.round(state.searchEntity.movieSuggestionCount ?? 5)));
      if (state.searchEntity.movieSuggestionCount !== suggestionCount) {
        state.searchEntity.movieSuggestionCount = suggestionCount;
        needsSave = true;
      }
      if (!["id", "title"].includes(state.searchEntity.movieSuggestionSearchMode)) {
        state.searchEntity.movieSuggestionSearchMode = "id";
        needsSave = true;
      }

      state.contentScript ??= {};
      const normalizedToolbarPlacement = normalizeToolbarPlacement({
        dockSide: state.contentScript.dockSide,
        edgeOffset: state.contentScript.edgeOffset,
        verticalRatio: state.contentScript.verticalRatio,
      });
      for (const key of ["dockSide", "edgeOffset", "verticalRatio"] as const) {
        if (state.contentScript[key] !== normalizedToolbarPlacement[key]) {
          state.contentScript[key] = normalizedToolbarPlacement[key];
          needsSave = true;
        }
      }
      if (!Number.isInteger(state.contentScript.toolbarPositionVersion)) {
        state.contentScript.toolbarPositionVersion = 0;
        needsSave = true;
      }
      if (!state.contentScript.position || typeof state.contentScript.position !== "object") {
        state.contentScript.position = { x: 0, y: 0 };
        needsSave = true;
      }

      if (needsSave) {
        context.store.$save();
      }
    },
  },
  state: (): IConfigPiniaStorageSchema => ({
    version: "",
    lang: "zh_CN",
    theme: "light",
    isNavBarOpen: true,

    ignoreWrongPixelRatio: false,
    showReleaseNoteOnVersionChange: true,

    saveTableBehavior: true,
    enableTableMultiSort: false,

    contextMenus: {
      enabled: true,
      allowSelectionTextSearch: true,
      allowSocialLinkSearch: true,
      allowLinkDownloadPush: true,
    },

    contentScript: {
      enabled: true,
      enabledAtSocialSite: true,
      allowExceptionSites: false,

      toolbarPositionVersion: 0,
      dockSide: "right",
      edgeOffset: DEFAULT_TOOLBAR_EDGE_OFFSET,
      verticalRatio: 0.5,
      position: { x: 0, y: 0 },

      applyTheme: false,
      defaultOpenSpeedDial: false,
      stackedButtons: false,
      fadeEnterStyle: false,

      doubleConfirmAction: true,
      dragLinkOnSpeedDial: true,

      socialSiteSearchBy: "chosen",
    },

    tableBehavior: {
      MyData: {
        itemsPerPage: -1,
        columns: [
          "siteUserConfig.sortIndex",
          "name",
          "levelName",
          "uploaded",
          "ratio",
          "uploads",
          "seeding",
          "seedingSize",
          "bonus",
          "bonusPerHour",
          "joinTime",
          "updateAt",
        ],
        sortBy: [{ key: "siteUserConfig.sortIndex", order: "desc" }],
      },
      SearchEntity: {
        itemsPerPage: 50,
        columns: [
          "site",
          "title",
          "category",
          "size",
          "seeders",
          "leechers",
          "completed",
          "comments",
          "time",
          "action",
        ],
        sortBy: [{ key: "time", order: "desc" }],
      },
      DownloadHistory: {
        itemsPerPage: 10,
        sortBy: [{ key: "downloadAt", order: "desc" }],
      },
      MyCollection: {
        itemsPerPage: 10,
        sortBy: [{ key: "time", order: "desc" }],
      },
      SearchResultSnapshot: {
        itemsPerPage: 25,
        sortBy: [{ key: "createdAt", order: "desc" }],
      },
      SetDownloader: {
        itemsPerPage: 10,
        sortBy: [{ key: "enabled", order: "desc" }],
      },
      MyClient: {
        itemsPerPage: 25,
        columns: [
          "clientId",
          "name",
          "totalSize",
          "progress",
          "state",
          "ratio",
          "uploadSpeed",
          "downloadSpeed",
          "dateAdded",
          "action",
        ],
        sortBy: [{ key: "dateAdded", order: "desc" }],
      },
      SetSearchSolution: {
        itemsPerPage: 10,
      },
      SetSite: {
        itemsPerPage: -1,
        sortBy: [{ key: "userConfig.sortIndex", order: "desc" }],
      },
    },

    userName: "",

    myDataTableControl: {
      showSiteName: true,
      showUnreadMessage: true,
      showUserName: true,
      normalizeLevelName: true,
      showLevelRequirement: true,
      onlyShowUserLevelRequirement: true,
      showNextLevelInTable: false,
      showNextLevelInDialog: true,
      showHnR: true,
      showSeedingBonus: true,
      //joinTimeWeekOnly: false,
      joinTimeFormat: "alive",
      updateAtFormatAsAlive: true,
      showIntervalAsDate: false,
      simplifyBonusNumbers: false,
      showBonusNeededInterval: true,
    },

    userDataTimelineControl: {
      title: "",
      showField: {
        uploads: true,
        uploaded: true,
        downloaded: true,
        seeding: true,
        seedingSize: true,
        bonus: true,
        bonusPerHour: true,
        ratio: true,
      },
      showPerSiteField: {
        siteName: false,
        name: true,
        level: true,
        uid: true,
      },
      showTop: true,
      showTimeline: true,
      backgroundColor: defaultTimelineBackgroundColor,
      dateFormat: "time_added",
      faviconBlue: 3,
      selectedSites: [],
    },

    userStatisticControl: {
      showChart: {
        totalSiteBase: true,
        totalSiteSeeding: true,
        perSiteKuploaded: true,
        perSiteKuploadedIncr: true,
        perSiteKdownloaded: true,
        perSiteKdownloadedIncr: true,
        perSiteKseeding: true,
        perSiteKseedingIncr: true,
        perSiteKseedingSize: true,
        perSiteKseedingSizeIncr: true,
        perSiteKbonus: true,
        perSiteKbonusIncr: true,
        perSiteKseedingBonus: false,
        perSiteKseedingBonusIncr: false,
      },
      dateRange: 30,
      hidePerSitePrecentThreshold: 1,
      selectedSites: [],
    },

    searchEntifyControl: {
      showSiteName: true,
      showTorrentTag: true,
      showTorrentSubtitle: true,
      showSocialInformation: true,
      socialInformationSearchOnNewTab: true,
      uploadAtFormatAsAlive: false,
      limitTorrentTitleTdWidth: false,
      maxTagCountBeforeGroup: 0,
      hiddenTagNames: [],
    },

    userInfo: {
      queueConcurrency: 5,
      autoReflush: {
        enabled: true,
        interval: 3, // hours
        afterTime: "00:00",
        retry: {
          max: 3,
          interval: 5, // minutes
        },
      },
      alwaysPickLastUserInfo: true,
      showDeadSiteInOverview: false,
      showPassedSiteInOverview: false,
    },

    download: {
      saveDownloadHistory: true,
      allowDownloaderFilterForSite: false,
      initDownloaderTorrentOnEnter: false,
      saveLastDownloader: false,
      allowDirectSendToClient: false,
      localDownloadMethod: "browser",
      ignoreSiteDownloadIntervalWhenLocalDownload: true,
      useQuickSendToClient: true,
      downloadFailedRetry: false,
      downloadFailedFailedRetryCount: 3,
      downloadFailedFailedRetryInterval: 5,
      batchDownloadInterval: 0,
      enableBackgroundDownload: false,
      needConfirmWhenExceedSize: true,
      exceedSize: 10,
      exceedSizeUnit: "GiB",
    },

    searchEntity: {
      queueConcurrency: 8,

      allowSingleSiteSearch: false,
      treatTTQueryAsImdbSearch: true,

      saveLastFilter: true,
      forceImdbIdMatchFilter: true,
      autoDetectOfficialGroupFromTitle: false,

      quickSiteFilter: true,
      showHotRecommendations: true,
      movieSuggestionEnabled: true,
      movieSuggestionCount: 5,
      movieSuggestionSearchMode: "id",
    },

    mediaServerEntity: {
      queueConcurrency: 5,
      searchLimit: 50,
      autoSearchWhenMount: true,
      autoSearchMoreWhenScroll: true,
    },

    backup: {
      encryptionKey: "",
      encryptionEnabled: false,
      enabledAutoBackup: false,
      autoUploadUserData: {
        enabled: false,
        serverId: "",
      },
      retry: {
        max: 3,
        interval: 5,
      },
    },

    socialSiteInformation: {
      preferPtGen: true,
      timeout: 10e3,
      cacheDay: 7,
      socialSite: {
        anidb: {},
        bangumi: {},
        douban: {},
        imdb: {},
        tmdb: {},
        tvmaze: {},
      },
    },

    autoExtendCookies: {
      enabled: false,
      triggerThreshold: 2,
      extensionDuration: 3,
    },
  }),
  getters: {
    uiTheme(): Exclude<supportThemeType, "auto"> {
      if (this.theme === "auto") {
        const preferDark = usePreferredDark();
        return preferDark.value ? "dark" : "light";
      }
      return this.theme;
    },

    isLightUiTheme(): boolean {
      return this.uiTheme === "light";
    },

    getUserName(): string {
      if (this.userName === "") {
        return this.getUserNames.perfName;
      } else {
        return this.userName;
      }
    },

    getUserNames(state) {
      const metadataStore = useMetadataStore();

      const userNames = {
        perfName: "",
        names: {} as Record<string, number>,
      };

      const allNames = Object.values(metadataStore.lastUserInfo)
        .map((userInfo) => userInfo.name)
        .filter(Boolean) as string[];

      for (const name of allNames) {
        if (!userNames.names[name]) {
          userNames.names[name] = 0;
        }
        userNames.names[name]++;

        if (name !== userNames.perfName && userNames.names[name] > (userNames.names[userNames.perfName] ?? 0)) {
          userNames.perfName = name;
        }
      }

      return userNames;
    },
  },
  actions: {
    updateTableBehavior(table: string, key: string, data: any) {
      // @ts-ignore
      this.tableBehavior[table][key] = data;
      if (this.saveTableBehavior) {
        this.$save();
      }
    },

    updateContentScriptToolbarPlacement(placement: ToolbarPlacement, coordinates?: ToolbarCoordinates) {
      const normalized = normalizeToolbarPlacement(placement);
      this.contentScript.toolbarPositionVersion = TOOLBAR_POSITION_VERSION;
      this.contentScript.dockSide = normalized.dockSide;
      this.contentScript.edgeOffset = normalized.edgeOffset;
      this.contentScript.verticalRatio = normalized.verticalRatio;
      if (coordinates) {
        this.contentScript.position.x = coordinates.x;
        this.contentScript.position.y = coordinates.y;
      }
      this.$save();
    },

    updateContentScriptDockSide(dockSide: ToolbarDockSide) {
      this.contentScript.toolbarPositionVersion = TOOLBAR_POSITION_VERSION;
      this.contentScript.dockSide = dockSide;
      this.$save();
    },
  },
});
