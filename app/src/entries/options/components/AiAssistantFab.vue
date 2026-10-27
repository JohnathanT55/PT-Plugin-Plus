<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { sendMessage } from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { activeAiPageContext, activeAiPageKey } from "@/options/utils/aiContext.ts";
import type { IMcpBridgeConfig, IMcpBridgeStatus } from "@/shared/mcpBridge.ts";

import AiAssistantDialog from "../views/Overview/SearchEntity/AiAssistantDialog.vue";

const { t } = useI18n();
const route = useRoute();
const configStore = useConfigStore();
const open = ref(false);
const fab = ref<{ $el?: HTMLElement }>();
const bridgeStatus = ref<IMcpBridgeStatus | undefined>();
let statusTimer: ReturnType<typeof setTimeout> | undefined;
let statusGeneration = 0;
let statusInFlight = false;
let mounted = false;
const pageContext = computed(() => (activeAiPageKey.value === route.name ? activeAiPageContext.value : undefined));
const context = computed(() => pageContext.value?.context);
const torrentResults = computed(() =>
  context.value?.torrentResults?.map((item) => ({
    ...item,
    title: item.title ?? "",
  })),
);
const routeSuggestions = computed(() => {
  const name = String(route.name ?? "");
  const key = name.toLowerCase();
  if (key.includes("searchentity"))
    return [t("aiAssistant.suggestions.searchResults"), t("aiAssistant.suggestions.searchResources")];
  if (key.includes("mydata")) return [t("aiAssistant.suggestions.siteSummary")];
  if (key.includes("myclient") || key.includes("downloader")) return [t("aiAssistant.suggestions.downloaders")];
  if (key.includes("downloadhistory")) return [t("aiAssistant.suggestions.downloadHistory")];
  if (key.includes("mycollection") || key.includes("collection")) return [t("aiAssistant.suggestions.collection")];
  if (key.includes("keepupload")) return [t("aiAssistant.suggestions.keepUpload")];
  if (key.includes("backup")) return [t("aiAssistant.suggestions.backups")];
  if (key.includes("setsite") || key.includes("site")) return [t("aiAssistant.suggestions.sites")];
  if (key.includes("searchsolution")) return [t("aiAssistant.suggestions.searchSolutions")];
  return [t("aiAssistant.suggestions.generic")];
});
const suggestions = computed(() => {
  const contextual = pageContext.value?.suggestions ?? [];
  return contextual.length ? contextual : routeSuggestions.value;
});

const bridgeConnected = computed(
  () => configStore.mcp.enabled && bridgeStatus.value?.enabled === true && bridgeStatus.value.connected === true,
);

function configKey(config?: Partial<IMcpBridgeConfig>) {
  return JSON.stringify([
    config?.enabled === true,
    config?.bridgeUrl ?? "",
    config?.bridgeToken ?? "",
    config?.timeoutMs,
  ]);
}

function resetConnection() {
  ++statusGeneration;
  bridgeStatus.value = undefined;
  open.value = false;
  if (statusTimer) clearTimeout(statusTimer);
  if (mounted) void refreshBridgeStatus();
}

async function refreshBridgeStatus() {
  if (!mounted || statusInFlight || !configStore.mcp.enabled) return;
  statusInFlight = true;
  const generation = statusGeneration;
  const snapshot = configKey(configStore.mcp);
  try {
    // Settings are editable before Save. An old persisted bridge connection
    // must never make the newly edited configuration appear connected.
    const { config } = await chrome.storage.local.get("config");
    const persisted = config as { mcp?: IMcpBridgeConfig } | undefined;
    if (generation !== statusGeneration || snapshot !== configKey(persisted?.mcp)) return;
    const status = await sendMessage("getMcpBridgeStatus", undefined);
    if (!mounted || generation !== statusGeneration || snapshot !== configKey(configStore.mcp)) return;
    bridgeStatus.value = status;
    if (!bridgeStatus.value.connected) open.value = false;
  } catch {
    if (!mounted || generation !== statusGeneration) return;
    bridgeStatus.value = { enabled: true, connected: false, status: "error", capabilities: [] };
    open.value = false;
  } finally {
    statusInFlight = false;
    if (mounted && configStore.mcp.enabled) {
      statusTimer = setTimeout(() => void refreshBridgeStatus(), generation === statusGeneration ? 5_000 : 0);
    }
  }
}

watch(() => configKey(configStore.mcp), resetConnection, { flush: "sync" });
watch(open, async (value, previous) => {
  if (previous && !value && bridgeConnected.value) {
    await nextTick();
    fab.value?.$el?.focus();
  }
});
onMounted(() => {
  mounted = true;
  void refreshBridgeStatus();
});
onBeforeUnmount(() => {
  mounted = false;
  ++statusGeneration;
  if (statusTimer) clearTimeout(statusTimer);
});
</script>

<template>
  <v-btn
    v-if="bridgeConnected"
    ref="fab"
    class="ptpp-ai-fab"
    color="deep-purple"
    elevation="5"
    icon="mdi-robot-outline"
    :title="t('aiAssistant.dialogTitle')"
    :aria-label="t('aiAssistant.dialogTitle')"
    :aria-expanded="open"
    aria-controls="ptpp-ai-panel"
    @click="open = !open"
  />
  <AiAssistantDialog
    :model-value="bridgeConnected && open"
    :search-key="context?.searchKey"
    :torrent-titles="context?.torrentTitles"
    :torrent-results="torrentResults"
    :site-summary="context?.siteSummary"
    :suggestions="suggestions"
    @update:model-value="open = $event"
  />
</template>

<style scoped lang="scss">
.ptpp-ai-fab {
  position: fixed;
  z-index: 20;
  right: 20px;
  bottom: 20px;
}
</style>
