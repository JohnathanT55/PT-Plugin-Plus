<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { sendMessage } from "@/messages.ts";
import type { IAiAssistRequest } from "@/shared/aiAssistant.ts";
import { useAiSession } from "@/options/utils/aiSession.ts";
import MarkdownContent from "./utils/MarkdownContent.vue";

type Context = NonNullable<IAiAssistRequest["context"]>;
const props = defineProps<{
  modelValue: boolean;
  searchKey?: string;
  torrentTitles?: Context["torrentTitles"];
  torrentResults?: Context["torrentResults"];
  siteSummary?: Context["siteSummary"];
  suggestions?: string[];
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const { t } = useI18n();
const session = useAiSession();
const { prompt, messages: conversationMessages } = session;
const errorMessage = ref("");
const loading = ref(false);
const chatLog = ref<HTMLElement>();
const input = ref<{ focus: () => void }>();
let disposed = false;

const contextLabel = computed(() => {
  if (props.siteSummary?.length) return t("aiAssistant.siteContext", { count: props.siteSummary.length });
  if (props.searchKey?.trim()) return t("aiAssistant.searchContext", { value: props.searchKey });
  return "";
});

function close() {
  emit("update:modelValue", false);
}
function clearConversation() {
  session.clear();
  errorMessage.value = "";
  void nextTick(() => input.value?.focus());
}
function useSuggestion(suggestion: string) {
  session.expireIfNeeded();
  prompt.value = suggestion;
  void nextTick(() => input.value?.focus());
}

watch(
  () => props.modelValue,
  async (open) => {
    if (!open) return;
    session.expireIfNeeded();
    if (!conversationMessages.value.length && !prompt.value.trim() && props.suggestions?.[0]) {
      prompt.value = props.suggestions[0];
    }
    await nextTick();
    input.value?.focus();
    if (chatLog.value) chatLog.value.scrollTop = chatLog.value.scrollHeight;
  },
);
watch(
  () => conversationMessages.value.length,
  async () => {
    await nextTick();
    if (chatLog.value) chatLog.value.scrollTop = chatLog.value.scrollHeight;
  },
);

async function ask() {
  if (loading.value) return;
  session.expireIfNeeded();
  const userPrompt = prompt.value.trim();
  if (!userPrompt) {
    errorMessage.value = t("aiAssistant.empty");
    return;
  }
  const token = session.beginTurn();
  loading.value = true;
  errorMessage.value = "";
  try {
    const response = await sendMessage("runAiAssistant", {
      mode: "assist",
      prompt: userPrompt,
      history: conversationMessages.value.map((message) => ({ ...message })),
      context: {
        searchKey: props.searchKey,
        torrentTitles: props.torrentTitles,
        torrentResults: props.torrentResults,
        siteSummary: props.siteSummary,
      },
    });
    if (!disposed) session.completeTurn(token, userPrompt, response.text);
  } catch (error) {
    if (!disposed && session.revision.value === token) {
      errorMessage.value = error instanceof Error ? error.message : t("aiAssistant.testFailed");
    }
  } finally {
    loading.value = false;
  }
}
onBeforeUnmount(() => {
  disposed = true;
  session.dispose();
});
</script>

<template>
  <v-card
    v-if="modelValue"
    id="ptpp-ai-panel"
    class="ptpp-ai-panel"
    role="dialog"
    aria-modal="false"
    aria-labelledby="ptpp-ai-panel-title"
    elevation="12"
    @keydown.esc.stop="close"
  >
    <v-card-title class="d-flex align-center ga-2 ptpp-ai-panel__title">
      <v-icon icon="mdi-robot-outline" size="22" />
      <span id="ptpp-ai-panel-title" class="text-subtitle-1 text-truncate">{{ t("aiAssistant.dialogTitle") }}</span>
      <v-spacer />
      <v-btn
        icon="mdi-chat-plus-outline"
        size="small"
        variant="text"
        :disabled="loading"
        :title="t('aiAssistant.clearConversation')"
        :aria-label="t('aiAssistant.clearConversation')"
        @click="clearConversation"
      />
      <v-btn icon="mdi-close" size="small" variant="text" :aria-label="t('aiAssistant.close')" @click="close" />
    </v-card-title>
    <div class="px-4 pb-2 text-caption text-medium-emphasis">{{ t("aiAssistant.sessionNotice") }}</div>
    <v-divider />
    <div ref="chatLog" class="ai-chat-log" role="log" aria-live="polite" :aria-label="t('aiAssistant.chatHistory')">
      <p v-if="conversationMessages.length === 0" class="text-body-2 text-medium-emphasis">
        {{ t("aiAssistant.conversationEmpty") }}
      </p>
      <div
        v-for="(message, index) in conversationMessages"
        :key="index"
        class="ai-chat-message"
        :class="'ai-chat-message--' + message.role"
      >
        <div class="text-caption text-medium-emphasis mb-1">
          {{ message.role === "user" ? t("aiAssistant.you") : t("aiAssistant.assistant") }}
        </div>
        <MarkdownContent :source="message.content" />
      </div>
      <div v-if="loading" class="d-flex align-center ga-2 text-body-2" role="status">
        <v-progress-circular indeterminate size="16" width="2" />{{ t("aiAssistant.thinking") }}
      </div>
      <v-alert v-if="errorMessage" density="compact" type="error" variant="tonal">{{ errorMessage }}</v-alert>
    </div>
    <div class="ptpp-ai-panel__composer">
      <p v-if="contextLabel" class="text-caption text-medium-emphasis mb-2">{{ contextLabel }}</p>
      <div v-if="suggestions?.length" class="ai-suggestions" :aria-label="t('aiAssistant.suggestionsLabel')">
        <v-chip
          v-for="suggestion in suggestions"
          :key="suggestion"
          size="small"
          variant="tonal"
          class="ai-suggestion"
          @click="useSuggestion(suggestion)"
          >{{ suggestion }}</v-chip
        >
      </div>
      <v-textarea
        ref="input"
        v-model="prompt"
        :label="t('aiAssistant.prompt')"
        :placeholder="t('aiAssistant.promptPlaceholder')"
        density="compact"
        variant="outlined"
        class="mt-3"
        rows="3"
        no-resize
        counter="4000"
        maxlength="4000"
        @keydown.ctrl.enter.prevent="ask"
        @keydown.meta.enter.prevent="ask"
      />
      <div class="d-flex justify-end">
        <v-btn :loading="loading" :disabled="!prompt.trim()" color="primary" prepend-icon="mdi-send" @click="ask">{{
          t("aiAssistant.ask")
        }}</v-btn>
      </div>
    </div>
  </v-card>
</template>

<style scoped lang="scss">
.ptpp-ai-panel {
  position: fixed;
  z-index: 1000;
  right: 20px;
  bottom: 88px;
  width: min(420px, calc(100vw - 32px));
  height: min(620px, calc(100dvh - 108px));
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.ptpp-ai-panel__title {
  flex: 0 0 auto;
  padding: 8px 12px;
}
.ptpp-ai-panel__composer {
  flex: 0 0 auto;
  padding: 12px 16px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.12);
}
.ai-chat-log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1 1 auto;
  min-height: 0;
  padding: 16px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.ai-chat-message {
  flex-shrink: 0;
  min-width: 0;
  max-width: 100%;
  border-radius: 8px;
  padding: 8px 10px;
  overflow-wrap: anywhere;
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.ai-chat-message--user {
  align-self: flex-end;
  max-width: 90%;
  background: rgba(var(--v-theme-primary), 0.12);
}
.ai-suggestions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  max-height: 92px;
  overflow-y: auto;
}
.ai-suggestion {
  height: auto;
  min-height: 28px;
  padding-block: 4px;
  white-space: normal;
  :deep(.v-chip__content) {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
@media (max-height: 540px) {
  .ptpp-ai-panel {
    overflow-y: auto;
  }
  .ai-chat-log {
    flex: 0 0 auto;
    max-height: 160px;
  }
}
</style>
