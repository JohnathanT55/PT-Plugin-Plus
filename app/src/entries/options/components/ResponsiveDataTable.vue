<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, onUpdated, ref, watch } from "vue";
import type { DataTableHeader } from "vuetify";

import { measureHorizontalOverflow, normalizeResponsiveHeaders } from "@/options/utils/responsiveTable.ts";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    headers: readonly DataTableHeader[];
    primaryKeys?: readonly string[];
    actionKey?: string | readonly string[];
    actionWidth?: number | string;
    secondaryMinWidth?: number | string;
    topScrollbarLabel?: string;
  }>(),
  {
    primaryKeys: () => [],
    actionKey: "action",
    actionWidth: "11rem",
    secondaryMinWidth: "7rem",
    topScrollbarLabel: "Horizontal table scrollbar",
  },
);

const normalizedHeaders = computed(() =>
  normalizeResponsiveHeaders(props.headers, {
    primaryKeys: props.primaryKeys,
    actionKey: props.actionKey,
    actionWidth: props.actionWidth,
    secondaryMinWidth: props.secondaryMinWidth,
  }),
);

const host = ref<HTMLElement | null>(null);
const topScrollbar = ref<HTMLElement | null>(null);
const scrollWidth = ref(0);
const hasOverflow = ref(false);
let tableScroller: HTMLElement | null = null;
let observedTable: HTMLTableElement | null = null;
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let metricsScheduled = false;
let pendingConnectFrame: number | undefined;
let remainingConnectAttempts = 0;

function updateMetrics() {
  if (!tableScroller) return;
  const metrics = measureHorizontalOverflow(
    tableScroller.scrollWidth,
    tableScroller.clientWidth,
    tableScroller.scrollLeft,
  );
  scrollWidth.value = metrics.scrollWidth;
  hasOverflow.value = metrics.hasOverflow;
  if (topScrollbar.value && topScrollbar.value.scrollLeft !== metrics.scrollLeft) {
    topScrollbar.value.scrollLeft = metrics.scrollLeft;
  }
}

function scheduleMetrics() {
  if (metricsScheduled) return;
  metricsScheduled = true;
  queueMicrotask(() => {
    metricsScheduled = false;
    updateMetrics();
  });
}

function handleTableScroll() {
  if (tableScroller && topScrollbar.value && topScrollbar.value.scrollLeft !== tableScroller.scrollLeft) {
    topScrollbar.value.scrollLeft = tableScroller.scrollLeft;
  }
}

function handleTopScroll() {
  if (tableScroller && topScrollbar.value && tableScroller.scrollLeft !== topScrollbar.value.scrollLeft) {
    tableScroller.scrollLeft = topScrollbar.value.scrollLeft;
  }
}

function disconnectTableScroller() {
  tableScroller?.removeEventListener("scroll", handleTableScroll);
  tableScroller = null;
  observedTable = null;
  resizeObserver?.disconnect();
  resizeObserver = undefined;
}

function observeCurrentTable() {
  if (!tableScroller || !resizeObserver) return;
  const nextTable = tableScroller.querySelector<HTMLTableElement>("table");
  if (!nextTable || nextTable === observedTable) return;
  observedTable = nextTable;
  resizeObserver.observe(nextTable);
}

function scheduleConnectRetry() {
  if (pendingConnectFrame !== undefined || remainingConnectAttempts <= 0) return;
  remainingConnectAttempts -= 1;
  pendingConnectFrame = requestAnimationFrame(() => {
    pendingConnectFrame = undefined;
    connectScroller();
  });
}

function connectScroller() {
  const nextScroller = host.value?.querySelector<HTMLElement>(".v-table__wrapper") ?? null;
  if (!nextScroller) {
    scheduleConnectRetry();
    return;
  }
  if (nextScroller === tableScroller) {
    observeCurrentTable();
    scheduleMetrics();
    return;
  }

  disconnectTableScroller();
  tableScroller = nextScroller;
  tableScroller.addEventListener("scroll", handleTableScroll, { passive: true });

  resizeObserver = new ResizeObserver(scheduleMetrics);
  resizeObserver.observe(tableScroller);
  observeCurrentTable();
  scheduleMetrics();
}

watch(normalizedHeaders, connectScroller, { flush: "post" });
watch(
  host,
  (currentHost) => {
    mutationObserver?.disconnect();
    mutationObserver = undefined;
    disconnectTableScroller();
    if (!currentHost) return;

    mutationObserver = new MutationObserver(connectScroller);
    mutationObserver.observe(currentHost, { childList: true, subtree: true });
    remainingConnectAttempts = 120;
    connectScroller();
  },
  { flush: "post" },
);
onMounted(() => {
  remainingConnectAttempts = 120;
  connectScroller();
});
onUpdated(connectScroller);

onBeforeUnmount(() => {
  mutationObserver?.disconnect();
  mutationObserver = undefined;
  disconnectTableScroller();
  if (pendingConnectFrame !== undefined) cancelAnimationFrame(pendingConnectFrame);
});
</script>

<template>
  <div ref="host" class="ptpp-responsive-data-table">
    <div
      v-show="hasOverflow"
      ref="topScrollbar"
      :aria-label="topScrollbarLabel"
      class="ptpp-responsive-table-scrollbar"
      role="scrollbar"
      tabindex="0"
      @scroll.passive="handleTopScroll"
    >
      <div class="ptpp-responsive-table-scrollbar__spacer" :style="{ width: `${scrollWidth}px` }" />
    </div>

    <v-data-table v-bind="$attrs" :headers="normalizedHeaders as DataTableHeader[]">
      <template v-for="(_, slotName) in $slots" #[slotName]="slotProps">
        <slot :name="slotName" v-bind="slotProps ?? {}" />
      </template>
    </v-data-table>
  </div>
</template>
