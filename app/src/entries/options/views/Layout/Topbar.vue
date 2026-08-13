<script lang="ts" setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import PQueue from "p-queue";
import { useI18n } from "vue-i18n";
import { useDisplay } from "vuetify";
import { useRoute, useRouter } from "vue-router";

import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { sendMessage } from "@/messages.ts";
import { getMovieSuggestionSearchTerm, type ISocialMovieSuggestion } from "@ptd/social";

import { REPO_URL } from "~/helper";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import RecommendationMenu from "./RecommendationMenu.vue";

const route = useRoute();
const router = useRouter();
const display = useDisplay();
const { t } = useI18n();

const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const appendMenu = computed<Array<{ title: string; icon: string; [str: string]: any }>>(() => [
  { title: t("layout.header.home"), icon: "mdi-home", href: REPO_URL },
  { title: t("layout.header.wiki"), icon: "mdi-help-circle", href: `${REPO_URL}/wiki` },
]);

const searchKey = ref<string>("");
const searchPlanKey = ref<string>("default");
const navigationToggleBusy = ref(false);
const movieSuggestions = ref<ISocialMovieSuggestion[]>([]);
const movieSuggestionMenuOpen = ref(false);
const movieSuggestionLoading = ref(false);
const movieSuggestionFailed = ref(false);
const searchInputRevision = ref(0);
let movieSuggestionTimer: ReturnType<typeof setTimeout> | undefined;
let movieSuggestionRequestId = 0;
let suppressedMovieSuggestionQuery: string | undefined;

const searchPlans = computed(() =>
  metadataStore.getSearchSolutions
    .filter((x) => !!x.enabled) // 过滤掉未启用的搜索方案
    .sort((a, b) => b.sort - a.sort) // 按照 sort 降序排序
    .map((x) => ({
      id: x.id,
      name: x.name,
    })),
);

function startSearchEntity() {
  const normalizedSearchKey = typeof searchKey.value === "string" ? searchKey.value.trim() : "";
  searchKey.value = normalizedSearchKey;
  movieSuggestionMenuOpen.value = false;
  router.push({
    name: "SearchEntity",
    query: {
      search: searchKey.value,
      plan: searchPlanKey.value,
      flush: 1,
    },
  });
}

async function selectMovieSuggestion(rawItem: unknown) {
  let item = rawItem as ISocialMovieSuggestion;
  const searchMode = configStore.searchEntity.movieSuggestionSearchMode;

  // The fast Douban suggest response has no IMDb identity. Resolve the
  // candidate before searching so an immediate click still gets the wider
  // IMDb tracker coverage; metadata failure safely retains the Douban term.
  if (searchMode === "id" && item.site === "douban" && !item.imdbId) {
    movieSuggestionLoading.value = true;
    try {
      const result = await sendMessage("getMovieSuggestionDetails", { item });
      item = result.item;
    } catch {
      // Keep the original Douban identity when every metadata provider fails.
    } finally {
      movieSuggestionLoading.value = false;
    }
  }

  const selectedSearchTerm = getMovieSuggestionSearchTerm(item, searchMode);
  suppressedMovieSuggestionQuery = selectedSearchTerm;
  movieSuggestions.value = [];
  searchKey.value = selectedSearchTerm;
  startSearchEntity();
  // VCombobox applies its own selection model after the slotted row click.
  // Re-assert the PTPP advanced-search term on the next tick so the visible
  // input never degrades to a bare Douban/IMDb ID.
  void nextTick(() => {
    searchKey.value = selectedSearchTerm;
    searchInputRevision.value += 1;
  });
}

function updateMovieSuggestion(enrichedItem: ISocialMovieSuggestion) {
  movieSuggestions.value = movieSuggestions.value.map((item) =>
    item.site === enrichedItem.site && item.id === enrichedItem.id ? enrichedItem : item,
  );
}

async function enrichMovieSuggestions(requestId: number, items: ISocialMovieSuggestion[]) {
  const queue = new PQueue({ concurrency: 3 });
  await Promise.all(
    items.map((item) =>
      queue.add(async () => {
        try {
          const result = await sendMessage("getMovieSuggestionDetails", { item });
          if (requestId === movieSuggestionRequestId) updateMovieSuggestion(result.item);
        } catch {
          // Basic candidates remain usable when every metadata provider fails.
        }
      }),
    ),
  );
}

async function loadMovieSuggestions(query: string) {
  const requestId = ++movieSuggestionRequestId;
  movieSuggestionLoading.value = true;
  movieSuggestionFailed.value = false;

  try {
    const result = await sendMessage("queryMovieSuggestions", {
      query,
      count: configStore.searchEntity.movieSuggestionCount,
    });
    if (requestId !== movieSuggestionRequestId) return;

    movieSuggestions.value = result.items;
    movieSuggestionFailed.value = result.failed;
    movieSuggestionMenuOpen.value = true;
    void enrichMovieSuggestions(requestId, [...result.items]);
  } catch {
    if (requestId !== movieSuggestionRequestId) return;
    movieSuggestions.value = [];
    movieSuggestionFailed.value = true;
    movieSuggestionMenuOpen.value = true;
  } finally {
    if (requestId === movieSuggestionRequestId) movieSuggestionLoading.value = false;
  }
}

function scheduleMovieSuggestions(value: unknown) {
  if (movieSuggestionTimer) clearTimeout(movieSuggestionTimer);
  const query = typeof value === "string" ? value.trim() : "";

  if (suppressedMovieSuggestionQuery === query) {
    suppressedMovieSuggestionQuery = undefined;
    movieSuggestionRequestId += 1;
    movieSuggestions.value = [];
    movieSuggestionFailed.value = false;
    movieSuggestionMenuOpen.value = false;
    movieSuggestionLoading.value = false;
    return;
  }
  suppressedMovieSuggestionQuery = undefined;

  if (!configStore.searchEntity.movieSuggestionEnabled || !query) {
    movieSuggestionRequestId += 1;
    movieSuggestions.value = [];
    movieSuggestionFailed.value = false;
    movieSuggestionMenuOpen.value = false;
    movieSuggestionLoading.value = false;
    return;
  }

  movieSuggestionTimer = setTimeout(() => void loadMovieSuggestions(query), 500);
}

function movieSuggestionPoster(item: ISocialMovieSuggestion) {
  return item.poster && !/doubanio\.com/.test(item.poster) ? item.poster : "/icons/movie_placeholder.png";
}

function searchRecommendation(title: string) {
  suppressedMovieSuggestionQuery = title;
  searchKey.value = title;
  startSearchEntity();
}

async function toggleNavigation() {
  if (navigationToggleBusy.value) return;

  navigationToggleBusy.value = true;
  try {
    // A click can arrive while the persisted Pinia state is still hydrating.
    // Toggling only after hydration prevents the restored value from silently
    // overwriting the user's click.
    await configStore.$onReady();
    configStore.isNavBarOpen = !configStore.isNavBarOpen;
    await configStore.$save();
  } finally {
    navigationToggleBusy.value = false;
  }
}

watch(
  () => route.query,
  (newQuery) => {
    if (newQuery?.search && (newQuery.search as string) !== searchKey.value) {
      suppressedMovieSuggestionQuery = newQuery.search as string;
      searchKey.value = newQuery.search as string;
    }
    if (newQuery?.plan && (newQuery.plan as string) !== searchPlanKey.value) {
      searchPlanKey.value = newQuery.plan as string;
    }
  },
);

watch(searchKey, scheduleMovieSuggestions);
onBeforeUnmount(() => movieSuggestionTimer && clearTimeout(movieSuggestionTimer));
</script>

<template>
  <v-app-bar id="ptpp-topbar" app color="amber" :height="64">
    <template #prepend>
      <button
        type="button"
        class="ptpp-nav-toggle"
        :aria-expanded="configStore.isNavBarOpen"
        :disabled="navigationToggleBusy"
        :title="t('layout.header.navBarTip')"
        @click.stop="toggleNavigation"
      >
        <template v-if="display.smAndUp.value">
          <v-icon icon="$menu"></v-icon>
        </template>
        <template v-else>
          <v-img inline src="/icons/logo/64.png" width="24"></v-img>
        </template>
      </button>
    </template>

    <v-app-bar-title v-show="display.smAndUp.value" ref="titleTarget" style="min-width: 180px; max-width: 220px">
      {{ t("manifest.extName") }}
    </v-app-bar-title>

    <!-- 搜索输入框 -->
    <v-combobox
      :key="searchInputRevision"
      v-model="searchKey"
      v-model:menu="movieSuggestionMenuOpen"
      :items="movieSuggestions"
      :loading="movieSuggestionLoading"
      :placeholder="t('layout.header.searchTip')"
      class="ptpp-search-input pl-2"
      clearable
      enterkeyhint="search"
      hide-details
      item-title="searchTerm"
      item-value="searchTerm"
      no-filter
      :return-object="false"
      style="width: 300px"
      type="search"
      @keyup.enter="startSearchEntity"
    >
      <template #prepend-item>
        <v-list-item
          v-if="typeof searchKey === 'string' && searchKey.trim()"
          prepend-icon="mdi-magnify"
          :title="t('layout.header.movieSuggestions.directSearch', { key: searchKey.trim() })"
          @mousedown.prevent
          @click.stop="startSearchEntity"
        />
        <v-divider v-if="movieSuggestions.length > 0" />
      </template>

      <template #item="{ item }">
        <v-list-item
          class="ptpp-movie-suggestion"
          @mousedown.prevent
          @pointerdown.prevent.stop
          @click.stop="selectMovieSuggestion(item.raw)"
        >
          <template #prepend>
            <v-img
              :src="movieSuggestionPoster(item.raw)"
              class="ptpp-movie-suggestion-poster mr-3"
              cover
              referrerpolicy="no-referrer"
            >
              <template #error>
                <v-img src="/icons/movie_placeholder.png" class="ptpp-movie-suggestion-poster" cover />
              </template>
            </v-img>
          </template>

          <v-list-item-title class="d-flex align-center ga-2">
            <span class="text-truncate">{{ item.raw.title }}</span>
            <span v-if="item.raw.year" class="text-caption text-medium-emphasis">({{ item.raw.year }})</span>
          </v-list-item-title>
          <v-list-item-subtitle v-if="item.raw.originalTitle" class="text-truncate">
            {{ item.raw.originalTitle }}
          </v-list-item-subtitle>

          <template #append>
            <div v-if="item.raw.ratingScore" class="ptpp-movie-suggestion-rating">
              <v-icon color="amber-darken-2" icon="mdi-star" size="x-small" />
              {{ Number(item.raw.ratingScore).toFixed(1) }}
            </div>
          </template>
        </v-list-item>
      </template>

      <template #append-item>
        <v-list-item
          v-if="!movieSuggestionLoading && movieSuggestions.length === 0 && movieSuggestionFailed"
          prepend-icon="mdi-cloud-alert-outline"
          :title="t('layout.header.movieSuggestions.loadFailed')"
          :subtitle="t('layout.header.movieSuggestions.directSearchFallback')"
        />
        <v-list-item
          v-else-if="!movieSuggestionLoading && movieSuggestions.length === 0"
          prepend-icon="mdi-movie-search-outline"
          :title="t('layout.header.movieSuggestions.empty')"
        />
      </template>

      <template #append>
        <!-- 搜索按键 -->
        <v-btn
          :disabled="runtimeStore.search.isSearching"
          icon="mdi-magnify"
          :title="t('common.search')"
          @click="startSearchEntity"
        />
      </template>

      <template #append-inner>
        <RecommendationMenu
          v-if="configStore.searchEntity.showHotRecommendations"
          :disabled="runtimeStore.search.isSearching"
          @search="searchRecommendation"
        />
      </template>

      <template #prepend-inner>
        <!-- 搜索方案选择框 -->
        <v-menu>
          <template v-slot:activator="{ props }">
            <v-btn v-bind="props" color="primary">
              {{
                searchPlanKey == "default"
                  ? t("layout.header.searchPlan.default")
                  : metadataStore.getSearchSolutionName(searchPlanKey)
              }}
            </v-btn>
          </template>
          <v-list>
            <!-- 默认搜索方案 -->
            <v-list-item
              :subtitle="
                '<' +
                (metadataStore.defaultSolutionId !== 'default'
                  ? metadataStore.getSearchSolutionName(metadataStore.defaultSolutionId)
                  : t('layout.header.searchPlan.all')) +
                '>'
              "
              :title="t('layout.header.searchPlan.default')"
              @click="() => (searchPlanKey = 'default')"
            />

            <!-- 全部站点搜索方案（仅当默认搜索不是全部站点时出现） -->
            <template v-if="metadataStore.defaultSolutionId !== 'default'">
              <v-list-item
                :title="t('layout.header.searchPlan.all')"
                @click="() => (searchPlanKey = 'all')"
              ></v-list-item>
            </template>

            <!-- 单个站点搜索方案 -->
            <v-list-item
              v-if="configStore.searchEntity.allowSingleSiteSearch"
              :title="t('layout.header.searchPlan.singleSite')"
            >
              <template v-slot:append>
                <v-icon icon="mdi-menu-right" size="x-small"></v-icon>
              </template>

              <v-menu
                :open-on-focus="false"
                open-on-hover
                :open-on-click="display.mobile.value"
                activator="parent"
                submenu
              >
                <v-list>
                  <template v-for="siteMetadata in metadataStore.getSortedAddedSites" :key="siteMetadata.id">
                    <v-list-item
                      v-if="siteMetadata.allowSearch ?? false"
                      @click="() => (searchPlanKey = `site:${siteMetadata.id}`)"
                    >
                      <template #prepend>
                        <SiteFavicon :site-id="siteMetadata.id" />
                      </template>
                      <SiteName :class="['v-list-item-title', 'ml-2']" :site-id="siteMetadata.id" tag="span" />
                    </v-list-item>
                  </template>
                </v-list>
              </v-menu>
            </v-list-item>

            <v-divider />

            <!-- 用户自定义的搜索方案列表 -->
            <v-list-item
              v-for="(item, index) in searchPlans"
              :key="index"
              :value="index"
              @click="() => (searchPlanKey = item.id)"
            >
              <v-list-item-title>{{ metadataStore.getSearchSolutionName(item.id) }}</v-list-item-title>
            </v-list-item>
          </v-list>
        </v-menu>
      </template>
    </v-combobox>

    <v-spacer v-if="display.smAndUp.value" />

    <template #append>
      <template v-if="!display.mdAndDown.value">
        <!-- 处于大屏幕，完整显示所有btn -->
        <v-btn
          v-for="(append, index) in appendMenu"
          :key="index"
          v-bind.prop="append.prop"
          :prepend-icon="append.icon"
          :href="append.href"
          :title="append.title"
          rel="noopener noreferrer nofollow"
          size="large"
          target="_blank"
          variant="text"
        >
          <span class="ml-1">{{ append.title }}</span>
        </v-btn>
      </template>

      <template v-else>
        <!-- 处于小屏幕，只显示点，btn以menu列表形式展示 -->
        <v-menu bottom left offset-y>
          <template #activator="{ props }">
            <v-btn :title="t('layout.header.expand')" v-bind="props" icon="mdi-dots-vertical" variant="text" />
          </template>

          <v-list>
            <v-list-item
              v-for="(item, index) in appendMenu"
              :key="index"
              :href="item.href"
              :prepend-icon="item.icon"
              :title="item.title"
              variant="text"
              rel="noopener noreferrer nofollow"
              size="large"
              class="menu-item list-item-none-spacer"
              target="_blank"
            />
          </v-list>
        </v-menu>
      </template>
    </template>
  </v-app-bar>
</template>

<style scoped lang="scss">
.menu-item:deep(.v-list-item__prepend > .v-icon) {
  margin-inline-end: 16px;
}

.ptpp-search-input:deep(.v-input__append) {
  align-items: center;
  align-self: stretch;
  padding-top: 0;
}

.ptpp-movie-suggestion {
  min-height: 72px;
}

.ptpp-movie-suggestion-poster {
  border-radius: 2px;
  height: 58px;
  width: 40px;
}

.ptpp-movie-suggestion-rating {
  align-items: center;
  display: flex;
  font-size: 12px;
  gap: 3px;
  min-width: 42px;
}
</style>
