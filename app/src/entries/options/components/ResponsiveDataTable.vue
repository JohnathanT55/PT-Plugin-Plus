<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { DataTableHeader } from "vuetify";

import {
  measureHorizontalOverflow,
  normalizeResponsiveHeaders,
} from "@/options/utils/responsiveTable.ts";

defineOptions({ inheritAttrs: false });

const props = withDefaults(
  defineProps<{
    headers: readonly DataTableHeader[];
    actionKey?: string | readonly string[];
    actionWidth?: number | string;
    topScrollbarLabel?: string;
  }>(),
  {
    actionKey: "action",
    actionWidth: "11rem",
    topScrollbarLabel: "Horizontal table scrollbar",
  },
);

const normalizedHeaders = computed(() =>
  normalizeResponsiveHeaders(props.headers, {
    actionKey: props.actionKey,
    actionWidth: props.actionWidth,
  }),
);

const host = ref<HTMLElement | null>(null);
const topScrollbar = ref<HTMLElement | null>(null);
const scrollWidth = ref(0);
const hasOverflow = ref(false);
let tableScroller: HTMLElement | null = null;
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let pendingFrame: number | undefined;

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
  if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
  pendingFrame = requestAnimationFrame(() => {
    pendingFrame = undefined;
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

function disconnectScroller() {
  tableScroller?.removeEventListener("scroll", handleTableScroll);
  tableScroller = null;
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
}

function connectScroller() {
  void nextTick(() => {
    const nextScroller = host.value?.querySelector<HTMLElement>(".v-table__wrapper") ?? null;
    if (!nextScroller) return;

    // Header/slot changes can reconnect the same Vuetify wrapper. Tear down
    // every observer first so repeated table updates cannot leak observers.
    disconnectScroller();
    tableScroller = nextScroller;
    tableScroller.addEventListener("scroll", handleTableScroll, { passive: true });

    resizeObserver = new ResizeObserver(scheduleMetrics);
    resizeObserver.observe(tableScroller);
    const table = tableScroller.querySelector("table");
    if (table) resizeObserver.observe(table);

    mutationObserver = new MutationObserver(scheduleMetrics);
    mutationObserver.observe(tableScroller, { childList: true, subtree: true });
    scheduleMetrics();
  });
}

watch(normalizedHeaders, connectScroller, { flush: "post" });
onMounted(connectScroller);

onBeforeUnmount(() => {
  disconnectScroller();
  if (pendingFrame !== undefined) cancelAnimationFrame(pendingFrame);
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
