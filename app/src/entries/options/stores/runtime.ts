/**
 * 此处放置一些其他数据，这些数据一般具有以下特征：
 * 1. 不需要persist
 * 2. 不需要跨tab共享的
 * 3. 可以在不同component中共享的
 */

import { defineStore } from "pinia";
import type { IRuntimePiniaStorageSchema, ISearchData, SnackbarMessageOptions } from "@/shared/types.ts";
import type { IMovieSearchIdentity } from "@ptd/social";

// PTD used to serialize the full current search (including torrent links) to
// sessionStorage. Remove that legacy value on upgrade and never write it again.
try {
  sessionStorage.removeItem("__ptd_runtime_store");
} catch {
  // Some non-page test contexts do not expose Web Storage.
}

const initialSearchData: () => ISearchData = () => ({
  isSearching: false,
  startAt: 0,
  endAt: 0,
  searchKey: "",
  searchPlanKey: "default",
  searchPlan: {},
  searchResult: [],
});

const initialMediaServerSearchData = () => ({
  isSearching: false,
  searchKey: "",
  searchStatus: {},
  searchResult: [],
});

export const useRuntimeStore = defineStore("runtime", {
  persistWebExt: false,
  state: (): IRuntimePiniaStorageSchema => ({
    search: initialSearchData(),
    userInfo: {
      flushPlan: {},
    },
    mediaServerSearch: initialMediaServerSearchData(),
    uiGlobalSnakebar: [],
  }),

  getters: {
    searchCostTime(state) {
      const plans = Object.values(state.search.searchPlan).filter((plan) => plan.startAt);

      if (plans.length === 0) {
        return 0;
      }

      const now = Date.now();
      const startTimes = plans.map((plan) => plan.startAt!);
      const endTimes = plans.map((plan) => plan.endAt || (plan.costTime ? plan.startAt! + plan.costTime : now));

      const earliestStart = Math.min(...startTimes);
      const latestEnd = Math.max(...endTimes);

      return latestEnd - earliestStart;
    },

    isUserInfoFlush(state) {
      return Object.values(state.userInfo.flushPlan).some((v) => v);
    },
  },

  actions: {
    resetSearchData() {
      this.search = initialSearchData();
    },

    resetMediaServerSearchData() {
      this.mediaServerSearch = initialMediaServerSearchData();
    },

    prepareMovieSearch(identity?: IMovieSearchIdentity) {
      this.pendingMovieIdentity = identity;
    },

    consumeMovieSearch(searchTerm: string): IMovieSearchIdentity | undefined {
      const pending = this.pendingMovieIdentity;
      this.pendingMovieIdentity = undefined;
      return pending?.boundSearchTerm.trim() === searchTerm.trim() ? pending : undefined;
    },

    showSnakebar(text: string, options: SnackbarMessageOptions = {}) {
      // @ts-ignore
      this.uiGlobalSnakebar.push({ text, ...options });
    },
  },
});
