<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import { useConfigStore } from "@/options/stores/config.ts";
import { activeAiPageContext } from "@/options/utils/aiContext.ts";

import AiAssistantDialog from "../views/Overview/SearchEntity/AiAssistantDialog.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const open = ref(false);
const context = computed(() => activeAiPageContext.value.context);
const torrentResults = computed(() =>
  activeAiPageContext.value.context?.torrentResults?.map((item) => ({
    ...item,
    title: item.title ?? "",
  })),
);
const suggestions = computed(() => activeAiPageContext.value.suggestions ?? []);
</script>

<template>
  <v-btn
    v-if="configStore.mcp.enabled"
    class="ptpp-ai-fab"
    color="deep-purple"
    elevation="5"
    icon="mdi-robot-outline"
    :title="t('aiAssistant.dialogTitle')"
    @click="open = true"
  />
  <AiAssistantDialog
    v-model="open"
    :conversation="true"
    :search-key="context?.searchKey"
    :torrent-titles="context?.torrentTitles"
    :torrent-results="torrentResults"
    :site-summary="context?.siteSummary"
    :suggestions="suggestions"
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
