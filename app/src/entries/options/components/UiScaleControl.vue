<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useDevicePixelRatio } from "@vueuse/core";
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import { UI_SCALE_STEPS, uiScaleDiagnostics, type UiScalePercent } from "@/shared/uiScale.ts";

withDefaults(
  defineProps<{
    compact?: boolean;
  }>(),
  { compact: false },
);

const { t } = useI18n();
const configStore = useConfigStore();
const { pixelRatio } = useDevicePixelRatio();

const lowerBound = computed(() => configStore.uiScale === UI_SCALE_STEPS[0]);
const upperBound = computed(() => configStore.uiScale === UI_SCALE_STEPS.at(-1));
const diagnostics = computed(() => uiScaleDiagnostics(configStore.uiScale, pixelRatio.value));
const browserZoom = ref<number | null>(null);
const systemScale = computed(() =>
  browserZoom.value ? Math.round((diagnostics.value.devicePixelRatio / browserZoom.value) * 100) : null,
);

function updateBrowserZoom(zoomFactor: number) {
  browserZoom.value = Math.round(zoomFactor * 100) / 100;
}

function handleBrowserZoomChange(change: chrome.tabs.OnZoomChangeInfo) {
  updateBrowserZoom(change.newZoomFactor);
}

onMounted(async () => {
  if (!chrome.tabs?.getZoom) return;
  try {
    updateBrowserZoom(await chrome.tabs.getZoom());
    chrome.tabs.onZoomChange.addListener(handleBrowserZoomChange);
  } catch {
    browserZoom.value = null;
  }
});

onBeforeUnmount(() => {
  if (chrome.tabs?.onZoomChange?.hasListener(handleBrowserZoomChange)) {
    chrome.tabs.onZoomChange.removeListener(handleBrowserZoomChange);
  }
});

function setScale(value: UiScalePercent) {
  void configStore.setUiScale(value);
}
</script>

<template>
  <v-menu :close-on-content-click="false" location="bottom end">
    <template #activator="{ props }">
      <v-btn
        v-bind="props"
        :aria-label="t('layout.header.uiScale.open')"
        class="ptpp-ui-scale-activator"
        :class="{ 'ptpp-ui-scale-activator--compact': compact }"
        icon
        :size="compact ? 'small' : 'default'"
        :title="t('layout.header.uiScale.current', { value: configStore.uiScale })"
        variant="text"
      >
        <span class="ptpp-ui-scale-value">{{ configStore.uiScale }}%</span>
      </v-btn>
    </template>

    <v-card class="ptpp-ui-scale-menu" width="340">
      <v-card-title class="text-subtitle-1">{{ t("layout.header.uiScale.title") }}</v-card-title>
      <v-card-text>
        <div class="ptpp-ui-scale-actions">
          <v-btn
            :disabled="lowerBound"
            icon="mdi-minus"
            size="small"
            :title="t('layout.header.uiScale.decrease')"
            variant="tonal"
            @click="configStore.stepUiScale(-1)"
          />
          <v-select
            :model-value="configStore.uiScale"
            :items="UI_SCALE_STEPS"
            density="compact"
            hide-details
            :label="t('layout.header.uiScale.internal')"
            suffix="%"
            @update:model-value="setScale"
          />
          <v-btn
            :disabled="upperBound"
            icon="mdi-plus"
            size="small"
            :title="t('layout.header.uiScale.increase')"
            variant="tonal"
            @click="configStore.stepUiScale(1)"
          />
        </div>
        <v-btn
          block
          class="mt-3"
          :disabled="configStore.uiScale === 100"
          prepend-icon="mdi-backup-restore"
          size="small"
          variant="text"
          @click="configStore.resetUiScale"
        >
          {{ t("layout.header.uiScale.reset") }}
        </v-btn>
        <v-divider class="my-3" />
        <div class="text-caption text-medium-emphasis">
          {{
            t("layout.header.uiScale.browserZoom", {
              value: browserZoom === null ? t("common.unknown") : Math.round(browserZoom * 100),
            })
          }}
        </div>
        <div class="mt-1 text-caption text-medium-emphasis">
          {{
            t("layout.header.uiScale.systemScale", {
              value: systemScale === null ? t("common.unknown") : systemScale,
            })
          }}
        </div>
        <div class="mt-1 text-caption text-medium-emphasis">
          {{ t("layout.header.uiScale.devicePixelRatio", { value: diagnostics.devicePixelRatio }) }}
        </div>
        <div class="mt-1 text-caption text-medium-emphasis">
          {{ t("layout.header.uiScale.devicePixelRatioHelp") }}
        </div>
      </v-card-text>
    </v-card>
  </v-menu>
</template>

<style scoped lang="scss">
.ptpp-ui-scale-activator {
  border-radius: 50%;
}

.ptpp-ui-scale-value {
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: -0.03em;
  white-space: nowrap;
}

.ptpp-ui-scale-actions {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: auto minmax(130px, 1fr) auto;
}
</style>
