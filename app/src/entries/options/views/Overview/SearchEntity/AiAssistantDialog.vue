<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage } from "@/messages.ts";

import MarkdownContent from "./utils/MarkdownContent.vue";

interface IAiSearchDraft {
  keyword: string;
  year?: string | number;
  season?: string | number;
  resolution?: string[];
  codec?: string[];
  audio?: string[];
  subtitle?: string[];
  sort?: string;
  notes?: string[];
}

const searchDraftKeys = new Set([
  "keyword",
  "year",
  "season",
  "resolution",
  "codec",
  "audio",
  "subtitle",
  "sort",
  "notes",
]);

function parseSearchDraft(text: string): IAiSearchDraft | undefined {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim();
  const candidate = fenced || text.trim();
  if (!candidate.startsWith("{") || !candidate.endsWith("}")) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const object = value as Record<string, unknown>;
  if (Object.keys(object).some((key) => !searchDraftKeys.has(key))) return undefined;
  if (typeof object.keyword !== "string") return undefined;
  const keyword = object.keyword.trim().slice(0, 240);
  if (!keyword) return undefined;

  const normalizeStringList = (input: unknown): string[] | undefined => {
    if (typeof input === "string") return input.trim() ? [input.trim().slice(0, 80)] : undefined;
    if (!Array.isArray(input)) return undefined;
    const values = input
      .filter((item): item is string => typeof item === "string")
      .map((item) => item.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 12);
    return values.length ? values : undefined;
  };
  const normalizeScalar = (input: unknown): string | number | undefined => {
    if (typeof input === "number" && Number.isFinite(input)) return input;
    if (typeof input === "string" && input.trim()) return input.trim().slice(0, 40);
    return undefined;
  };

  const draft: IAiSearchDraft = { keyword };
  for (const key of ["year", "season"] as const) {
    const normalized = normalizeScalar(object[key]);
    if (normalized !== undefined) draft[key] = normalized;
  }
  for (const key of ["resolution", "codec", "audio", "subtitle", "notes"] as const) {
    const normalized = normalizeStringList(object[key]);
    if (normalized) draft[key] = normalized;
  }
  const sort = normalizeScalar(object.sort);
  if (typeof sort === "string") draft.sort = sort;
  return draft;
}

const props = defineProps<{
  modelValue: boolean;
  searchKey?: string;
  torrentTitles?: string[];
  torrentResults?: Array<{
    site?: string;
    title: string;
    subTitle?: string;
    category?: string | number;
    size?: number;
    seeders?: number;
    leechers?: number;
    completed?: number;
    comments?: number;
    tags?: string[];
  }>;
  siteSummary?: Array<{
    site?: string;
    level?: string;
    ratio?: number;
    uploaded?: number;
    downloaded?: number;
    seeding?: number;
    seedingSize?: number;
    bonus?: number;
    hnr?: number;
    updatedAt?: string;
    nextLevel?: Record<string, string | number>;
  }>;
  initialMode?: "assist" | "search-draft" | "result-advice" | "site-summary";
  conversation?: boolean;
  suggestions?: string[];
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const { t } = useI18n();

const prompt = ref("");
const includeSearchContext = ref(true);
const mode = ref<"assist" | "search-draft" | "result-advice" | "site-summary">(props.initialMode ?? "assist");
const result = ref("");
const errorMessage = ref("");
const loading = ref(false);
const conversationMessages = ref<Array<{ role: "user" | "assistant"; content: string }>>([]);
const dialogModel = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});
const contextLabel = computed(() => {
  const value = props.searchKey?.trim();
  return value ? t("aiAssistant.searchContext", { value }) : "";
});
const modeItems = computed(() => {
  const items = [
    { value: "assist", title: t("aiAssistant.mode.assist"), subtitle: t("aiAssistant.mode.assistHint") },
    {
      value: "search-draft",
      title: t("aiAssistant.mode.searchDraft"),
      subtitle: t("aiAssistant.mode.searchDraftHint"),
    },
    {
      value: "result-advice",
      title: t("aiAssistant.mode.resultAdvice"),
      subtitle: t("aiAssistant.mode.resultAdviceHint"),
    },
  ];
  if ((props.siteSummary?.length ?? 0) > 0) {
    items.push({
      value: "site-summary",
      title: t("aiAssistant.mode.siteSummary"),
      subtitle: t("aiAssistant.mode.siteSummaryHint"),
    });
  }
  return items;
});
const resultContextLabel = computed(() => {
  const count = props.torrentResults?.length ?? 0;
  return count > 0 ? t("aiAssistant.resultContext", { count }) : "";
});
const siteContextLabel = computed(() => {
  const count = props.siteSummary?.length ?? 0;
  return count > 0 ? t("aiAssistant.siteContext", { count }) : "";
});
const parsedSearchDraft = computed(() =>
  mode.value === "search-draft" && result.value ? parseSearchDraft(result.value) : undefined,
);

function promptForMode(value: typeof mode.value): string {
  if (value === "search-draft") return t("aiAssistant.mode.searchDraftPrompt");
  if (value === "result-advice") return t("aiAssistant.mode.resultAdvicePrompt");
  if (value === "site-summary") return t("aiAssistant.mode.siteSummaryPrompt");
  return t("aiAssistant.mode.assistPrompt");
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      result.value = "";
      errorMessage.value = "";
      mode.value = props.initialMode ?? "assist";
      prompt.value = promptForMode(mode.value);
      conversationMessages.value = [];
    }
  },
);

watch(mode, (value) => {
  prompt.value = promptForMode(value);
});

async function ask() {
  if (!prompt.value.trim()) {
    errorMessage.value = t("aiAssistant.empty");
    return;
  }
  loading.value = true;
  const userPrompt = prompt.value.trim();
  if (!props.conversation) result.value = "";
  errorMessage.value = "";
  try {
    const effectiveMode = props.conversation ? "assist" : mode.value;
    const response = await sendMessage("runAiAssistant", {
      mode: effectiveMode,
      prompt: userPrompt,
      history: props.conversation ? conversationMessages.value : undefined,
      context: includeSearchContext.value
        ? {
            searchKey: props.searchKey,
            torrentTitles: props.torrentTitles,
            torrentResults: props.conversation || effectiveMode === "result-advice" ? props.torrentResults : undefined,
            siteSummary: props.conversation || effectiveMode === "site-summary" ? props.siteSummary : undefined,
          }
        : undefined,
    });
    if (props.conversation) {
      conversationMessages.value.push({ role: "user", content: userPrompt });
      conversationMessages.value.push({ role: "assistant", content: response.text });
      prompt.value = "";
    } else {
      result.value = response.text;
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : t("aiAssistant.testFailed");
  } finally {
    loading.value = false;
  }
}

async function copyResult() {
  if (!result.value) return;
  await navigator.clipboard.writeText(result.value);
}

async function copySearchDraftKeyword() {
  const keyword = parsedSearchDraft.value?.keyword;
  if (!keyword) return;
  await navigator.clipboard.writeText(keyword);
}

function applySearchDraft() {
  const keyword = parsedSearchDraft.value?.keyword;
  if (!keyword) return;
  if (!window.confirm(t("aiAssistant.applyDraftConfirm"))) return;
  window.dispatchEvent(new CustomEvent("ptpp-ai-search-draft", { detail: { keyword } }));
}
</script>

<template>
  <v-dialog v-model="dialogModel" max-width="720">
    <v-card>
      <v-card-title class="d-flex align-center ga-2">
        <v-icon icon="mdi-robot-outline" />
        {{ t("aiAssistant.dialogTitle") }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-4">{{ t("aiAssistant.dialogDescription") }}</p>
        <v-select
          v-if="!conversation"
          v-model="mode"
          :items="modeItems"
          item-title="title"
          item-value="value"
          :label="t('aiAssistant.mode.label')"
          :messages="modeItems.find((item) => item.value === mode)?.subtitle"
          density="compact"
          hide-details="auto"
        />
        <v-alert v-if="contextLabel" class="mb-3" density="compact" type="info" variant="tonal">
          {{ contextLabel }}
        </v-alert>
        <v-alert
          v-if="mode === 'result-advice' && resultContextLabel"
          class="mb-3"
          density="compact"
          type="info"
          variant="tonal"
        >
          {{ resultContextLabel }}
        </v-alert>
        <v-alert
          v-if="mode === 'site-summary' && siteContextLabel"
          class="mb-3"
          density="compact"
          type="info"
          variant="tonal"
        >
          {{ siteContextLabel }}
        </v-alert>
        <v-switch
          v-if="
            !conversation &&
            mode !== 'site-summary' &&
            (contextLabel ||
              (props.torrentTitles?.length ?? 0) > 0 ||
              (props.torrentResults?.length ?? 0) > 0 ||
              (props.siteSummary?.length ?? 0) > 0)
          "
          v-model="includeSearchContext"
          :label="t('aiAssistant.includeSearchContext')"
          color="success"
          density="compact"
          hide-details
        />
        <v-textarea
          v-if="!conversation"
          v-model="prompt"
          :label="t('aiAssistant.prompt')"
          :placeholder="t('aiAssistant.promptPlaceholder')"
          auto-grow
          autofocus
          class="mt-3"
          counter="4000"
          rows="4"
          @keydown.ctrl.enter="ask"
        />
        <div v-if="conversation" class="ai-chat-log mb-3" aria-live="polite">
          <div v-if="conversationMessages.length === 0" class="text-body-2 text-medium-emphasis">
            {{ t("aiAssistant.conversationEmpty") }}
          </div>
          <div
            v-for="(message, index) in conversationMessages"
            :key="`${message.role}-${index}`"
            class="ai-chat-message"
            :class="`ai-chat-message--${message.role}`"
          >
            <div class="text-caption text-medium-emphasis mb-1">
              {{ message.role === "user" ? t("aiAssistant.you") : t("aiAssistant.assistant") }}
            </div>
            <MarkdownContent :source="message.content" />
          </div>
        </div>
        <div v-if="conversation && suggestions?.length" class="d-flex flex-wrap ga-2 mt-2">
          <v-chip
            v-for="suggestion in suggestions"
            :key="suggestion"
            size="small"
            variant="tonal"
            @click="prompt = suggestion"
          >
            {{ suggestion }}
          </v-chip>
        </div>
        <v-textarea
          v-if="conversation"
          v-model="prompt"
          :label="t('aiAssistant.prompt')"
          :placeholder="t('aiAssistant.promptPlaceholder')"
          auto-grow
          autofocus
          class="mt-3"
          counter="4000"
          rows="3"
          @keydown.ctrl.enter="ask"
        />
        <v-alert v-if="errorMessage" class="mt-3" density="compact" type="error" variant="tonal">
          {{ errorMessage }}
        </v-alert>
        <v-card v-if="result" class="mt-4" variant="outlined">
          <v-card-text class="ai-result">
            <MarkdownContent :source="result" />
          </v-card-text>
          <v-card-actions class="justify-end">
            <template v-if="parsedSearchDraft">
              <v-chip class="mr-auto" color="primary" size="small" variant="tonal">
                {{ parsedSearchDraft.keyword }}
              </v-chip>
              <v-btn prepend-icon="mdi-magnify" variant="text" @click="applySearchDraft">
                {{ t("aiAssistant.applyDraft") }}
              </v-btn>
              <v-btn prepend-icon="mdi-content-copy" variant="text" @click="copySearchDraftKeyword">
                {{ t("aiAssistant.copyKeyword") }}
              </v-btn>
            </template>
            <v-btn prepend-icon="mdi-content-copy" variant="text" @click="copyResult">
              {{ t("aiAssistant.copy") }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn variant="text" @click="dialogModel = false">{{ t("common.dialog.cancel") }}</v-btn>
        <v-btn :loading="loading" color="primary" prepend-icon="mdi-send" variant="elevated" @click="ask">
          {{ t("aiAssistant.ask") }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.ai-result {
  max-height: 360px;
  overflow: auto;
}

.ai-chat-log {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 360px;
  overflow-y: auto;
}

.ai-chat-message {
  border-radius: 8px;
  padding: 8px 10px;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.ai-chat-message--user {
  align-self: flex-end;
  max-width: 90%;
  background: rgba(var(--v-theme-primary), 0.12);
}
</style>
