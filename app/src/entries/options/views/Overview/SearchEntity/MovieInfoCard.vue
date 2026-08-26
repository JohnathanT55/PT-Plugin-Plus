<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import type {
  IMovieEntityResponse,
  IMovieProviderStatus,
  IMovieRating,
  IMovieSearchIdentity,
  TMovieProviderName,
  TMovieRatingSource,
} from "@ptd/social";

import { sendMessage } from "@/messages.ts";
import { useI18n } from "vue-i18n";

const props = defineProps<{
  identity?: IMovieSearchIdentity;
  enabled: boolean;
}>();

const { locale, t } = useI18n();
const response = shallowRef<IMovieEntityResponse>();
const loading = ref(false);
const refreshing = ref(false);
const collapsed = ref(false);
const posterFailed = ref(false);
const loadFailed = ref(false);
const retryingProviders = ref<TMovieProviderName[]>([]);
let generation = 0;

const entity = computed(() => response.value?.entity);
const title = computed(() => entity.value?.title?.value || props.identity?.title || t("MovieInfoCard.unknownTitle"));
const originalTitle = computed(() => entity.value?.originalTitle?.value || props.identity?.originalTitle);
const poster = computed(() => (posterFailed.value ? undefined : entity.value?.poster?.value));
const aliases = computed(() => entity.value?.aliases?.value ?? props.identity?.aliases ?? []);

const detailRows = computed(() => {
  const rows = [
    ["directors", entity.value?.directors?.value],
    ["writers", entity.value?.writers?.value],
    ["cast", entity.value?.cast?.value],
    ["genres", entity.value?.genres?.value],
    ["regions", entity.value?.regions?.value],
    ["releaseDates", entity.value?.releaseDates?.value],
    ["runtimes", entity.value?.runtimes?.value],
  ] as const;
  return rows
    .filter((row): row is readonly [(typeof row)[0], string[]] => Boolean(row[1]?.length))
    .map(([key, values]) => ({ key, value: values.join(" / ") }));
});

const ratings = computed(() =>
  Object.values(entity.value?.ratings ?? {}).filter((rating): rating is IMovieRating => Boolean(rating)),
);

const failedProviders = computed(() =>
  Object.values(response.value?.providers ?? {}).filter(
    (status): status is IMovieProviderStatus => status?.state === "failed",
  ),
);

function currentIdentityKey(identity = props.identity) {
  return identity ? `${identity.canonicalKey}:${identity.selectedAt}:${identity.boundSearchTerm}` : "";
}

function isVisible(identity = props.identity) {
  return props.enabled && Boolean(identity?.canonicalKey);
}

function isCurrent(requestGeneration: number, identityKey: string) {
  return requestGeneration === generation && identityKey === currentIdentityKey() && isVisible();
}

async function loadMovieEntity() {
  const requestGeneration = ++generation;
  const identity = props.identity;
  const identityKey = currentIdentityKey(identity);
  response.value = undefined;
  posterFailed.value = false;
  loadFailed.value = false;
  refreshing.value = false;
  if (!props.enabled || !identity?.canonicalKey) {
    loading.value = false;
    return;
  }

  loading.value = true;
  try {
    const first = await sendMessage("getMovieEntity", { identity, allowStale: true });
    if (!isCurrent(requestGeneration, identityKey)) return;
    response.value = first;
    loading.value = false;

    if (first.stale) {
      refreshing.value = true;
      const refreshed = await sendMessage("getMovieEntity", { identity, allowStale: false });
      if (!isCurrent(requestGeneration, identityKey)) return;
      response.value = refreshed;
    }
  } catch {
    if (isCurrent(requestGeneration, identityKey)) loadFailed.value = true;
  } finally {
    if (isCurrent(requestGeneration, identityKey)) {
      loading.value = false;
      refreshing.value = false;
    }
  }
}

async function retryProvider(provider: TMovieProviderName) {
  const identity = props.identity;
  if (!identity || retryingProviders.value.includes(provider)) return;
  const requestGeneration = generation;
  const identityKey = currentIdentityKey(identity);
  retryingProviders.value = [...retryingProviders.value, provider];
  try {
    const refreshed = await sendMessage("getMovieEntity", {
      identity,
      allowStale: false,
      forceProviders: [provider],
    });
    if (isCurrent(requestGeneration, identityKey)) response.value = refreshed;
  } finally {
    retryingProviders.value = retryingProviders.value.filter((item) => item !== provider);
  }
}

function ratingLabel(source: TMovieRatingSource) {
  return t(`MovieInfoCard.rating.${source}`);
}

function providerLabel(provider: TMovieProviderName) {
  return t(`MovieInfoCard.provider.${provider}`);
}

function formatUpdatedAt(updatedAt: number) {
  return new Date(updatedAt).toLocaleString(locale.value.replace("_", "-"));
}

watch([() => props.identity, () => props.enabled], loadMovieEntity, { immediate: true, deep: true });
</script>

<template>
  <v-card v-if="enabled && identity?.canonicalKey" class="ptpp-movie-card" variant="outlined">
    <div class="movie-card-heading">
      <div class="movie-card-title-line">
        <v-icon icon="mdi-movie-open-outline" size="small" />
        <span class="font-weight-medium">{{ title }}</span>
        <span v-if="entity?.year?.value" class="text-medium-emphasis">({{ entity.year.value }})</span>
      </div>

      <div class="movie-card-state" role="status" aria-live="polite">
        <span v-if="entity?.updatedAt" class="movie-updated-at">
          {{ t("MovieInfoCard.updatedAt", { time: formatUpdatedAt(entity.updatedAt) }) }}
        </span>
        <v-chip v-if="response?.fromCache" color="info" size="x-small" variant="tonal">
          {{ t("MovieInfoCard.cached") }}
        </v-chip>
        <v-chip v-if="response?.stale" color="warning" size="x-small" variant="tonal">
          {{ t("MovieInfoCard.stale") }}
        </v-chip>
        <v-progress-circular v-if="refreshing" color="primary" indeterminate size="18" width="2" />
        <v-btn
          :aria-label="collapsed ? t('MovieInfoCard.expand') : t('MovieInfoCard.collapse')"
          :icon="collapsed ? 'mdi-chevron-down' : 'mdi-chevron-up'"
          size="x-small"
          variant="text"
          @click="collapsed = !collapsed"
        />
      </div>
    </div>

    <v-expand-transition>
      <div v-show="!collapsed" class="movie-card-body">
        <template v-if="loading">
          <v-skeleton-loader class="movie-poster-skeleton" type="image" />
          <div class="movie-card-copy">
            <v-skeleton-loader type="heading, text, text, text, paragraph, actions" />
          </div>
        </template>

        <template v-else>
          <div class="movie-poster-wrap">
            <v-img
              v-if="poster"
              :alt="t('MovieInfoCard.posterAlt', { title })"
              aspect-ratio="2/3"
              class="movie-poster"
              cover
              :src="poster"
              @error="posterFailed = true"
            />
            <div
              v-else
              class="movie-poster movie-poster-placeholder"
              role="img"
              :aria-label="t('MovieInfoCard.noPoster')"
            >
              <v-icon icon="mdi-movie-open" size="56" />
              <span>{{ t("MovieInfoCard.noPoster") }}</span>
            </div>
          </div>

          <div class="movie-card-copy">
            <div v-if="originalTitle && originalTitle !== title" class="movie-original-title">{{ originalTitle }}</div>

            <div v-if="aliases.length" class="movie-detail-row">
              <strong>{{ t("MovieInfoCard.aliases") }}</strong>
              <span>{{ aliases.join(" / ") }}</span>
            </div>
            <div v-for="row in detailRows" :key="row.key" class="movie-detail-row">
              <strong>{{ t(`MovieInfoCard.${row.key}`) }}</strong>
              <span>{{ row.value }}</span>
            </div>

            <p v-if="entity?.summary?.value" class="movie-summary">{{ entity.summary.value }}</p>
            <v-alert v-else-if="loadFailed || !entity" density="compact" type="warning" variant="tonal">
              {{ t("MovieInfoCard.noInformation") }}
            </v-alert>

            <div v-if="ratings.length" class="movie-ratings" :aria-label="t('MovieInfoCard.ratings')">
              <v-btn
                v-for="rating in ratings"
                :key="rating.source"
                :disabled="!rating.url"
                :href="rating.url"
                rel="noreferrer"
                size="small"
                target="_blank"
                variant="elevated"
              >
                {{ ratingLabel(rating.source) }} {{ rating.score }}/{{ rating.scale }}
                <span v-if="rating.count" class="rating-count">({{ rating.count.toLocaleString() }})</span>
              </v-btn>
            </div>

            <div v-if="failedProviders.length" class="provider-failures">
              <div class="provider-failure-title">
                <v-icon icon="mdi-alert-circle-outline" size="small" />
                {{ t("MovieInfoCard.partialFailure") }}
              </div>
              <div v-for="status in failedProviders" :key="status.provider" class="provider-failure-row">
                <span>
                  <strong>{{ providerLabel(status.provider) }}</strong>
                  — {{ status.errorMessage || t("MovieInfoCard.providerFailed") }}
                </span>
                <v-btn
                  :aria-label="t('MovieInfoCard.retryProvider', { provider: providerLabel(status.provider) })"
                  :loading="retryingProviders.includes(status.provider)"
                  color="warning"
                  icon="mdi-refresh"
                  size="x-small"
                  variant="text"
                  @click="retryProvider(status.provider)"
                />
              </div>
            </div>
          </div>
        </template>
      </div>
    </v-expand-transition>
  </v-card>
</template>

<style scoped lang="scss">
.ptpp-movie-card {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-border-color), 0.32);
  border-radius: 0;
  margin-bottom: 8px;
  overflow: hidden;
}

.movie-card-heading {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.08);
  border-bottom: 1px solid rgba(var(--v-border-color), 0.25);
  display: flex;
  gap: 12px;
  justify-content: space-between;
  min-height: 42px;
  padding: 5px 10px 5px 14px;
}

.movie-card-title-line,
.movie-card-state {
  align-items: center;
  display: flex;
  gap: 7px;
  min-width: 0;
}

.movie-card-title-line span:first-of-type {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.movie-card-state {
  flex: 0 0 auto;
}

.movie-updated-at {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  white-space: nowrap;
}

.movie-card-body {
  display: flex;
  gap: 18px;
  min-height: 254px;
  padding: 12px 14px 14px;
}

.movie-poster-wrap,
.movie-poster,
.movie-poster-skeleton {
  flex: 0 0 156px;
  height: 232px;
  width: 156px;
}

.movie-poster {
  border: 1px solid rgba(var(--v-border-color), 0.25);
  border-radius: 2px;
  overflow: hidden;
}

.movie-poster-placeholder {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.055);
  color: rgba(var(--v-theme-on-surface), 0.45);
  display: flex;
  flex-direction: column;
  gap: 8px;
  justify-content: center;
}

.movie-card-copy {
  flex: 1 1 auto;
  min-width: 0;
}

.movie-original-title {
  font-size: 1.05rem;
  font-weight: 500;
  margin-bottom: 8px;
}

.movie-detail-row {
  display: grid;
  font-size: 0.84rem;
  gap: 8px;
  grid-template-columns: 4.8rem minmax(0, 1fr);
  line-height: 1.55;
  margin-bottom: 2px;
}

.movie-detail-row strong {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-weight: 600;
}

.movie-summary {
  border-top: 1px dashed rgba(var(--v-border-color), 0.32);
  font-size: 0.86rem;
  line-height: 1.65;
  margin: 9px 0 0;
  padding-top: 8px;
  white-space: pre-line;
}

.movie-ratings {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
  margin-top: 11px;
}

.movie-ratings :deep(.v-btn) {
  border-radius: 2px;
  letter-spacing: 0;
  text-transform: none;
}

.rating-count {
  font-size: 0.72rem;
  margin-left: 4px;
  opacity: 0.76;
}

.provider-failures {
  background: rgba(var(--v-theme-warning), 0.08);
  border-left: 3px solid rgb(var(--v-theme-warning));
  margin-top: 12px;
  padding: 7px 9px;
}

.provider-failure-title,
.provider-failure-row {
  align-items: center;
  display: flex;
  gap: 6px;
}

.provider-failure-title {
  font-size: 0.82rem;
  font-weight: 600;
}

.provider-failure-row {
  font-size: 0.78rem;
  justify-content: space-between;
  margin-top: 3px;
}

@media (max-width: 760px) {
  .movie-card-heading {
    align-items: flex-start;
  }

  .movie-card-body {
    display: block;
    min-height: 0;
  }

  .movie-poster-wrap,
  .movie-poster,
  .movie-poster-skeleton {
    height: 210px;
    margin: 0 auto 12px;
    width: 140px;
  }

  .movie-detail-row {
    grid-template-columns: 4.2rem minmax(0, 1fr);
  }

  .movie-card-state .v-chip {
    display: none;
  }

  .movie-updated-at {
    display: none;
  }
}
</style>
