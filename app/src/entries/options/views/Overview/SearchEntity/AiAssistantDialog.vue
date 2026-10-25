<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage } from "@/messages.ts";

const props = defineProps<{
  modelValue: boolean;
  searchKey?: string;
  torrentTitles?: string[];
}>();
const emit = defineEmits<{ "update:modelValue": [value: boolean] }>();
const { t } = useI18n();

const prompt = ref("");
const includeSearchContext = ref(true);
const result = ref("");
const errorMessage = ref("");
const loading = ref(false);
const dialogModel = computed({
  get: () => props.modelValue,
  set: (value: boolean) => emit("update:modelValue", value),
});
const contextLabel = computed(() => {
  const value = props.searchKey?.trim();
  return value ? t("aiAssistant.searchContext", { value }) : "";
});

watch(
  () => props.modelValue,
  (open) => {
    if (open) {
      result.value = "";
      errorMessage.value = "";
    }
  },
);

async function ask() {
  if (!prompt.value.trim()) {
    errorMessage.value = t("aiAssistant.empty");
    return;
  }
  loading.value = true;
  result.value = "";
  errorMessage.value = "";
  try {
    const response = await sendMessage("runAiAssistant", {
      mode: "assist",
      prompt: prompt.value,
      context: includeSearchContext.value
        ? {
            searchKey: props.searchKey,
            torrentTitles: props.torrentTitles,
          }
        : undefined,
    });
    result.value = response.text;
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
        <v-alert v-if="contextLabel" class="mb-3" density="compact" type="info" variant="tonal">
          {{ contextLabel }}
        </v-alert>
        <v-switch
          v-if="contextLabel || (props.torrentTitles?.length ?? 0) > 0"
          v-model="includeSearchContext"
          :label="t('aiAssistant.includeSearchContext')"
          color="success"
          density="compact"
          hide-details
        />
        <v-textarea
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
        <v-alert v-if="errorMessage" class="mt-3" density="compact" type="error" variant="tonal">
          {{ errorMessage }}
        </v-alert>
        <v-card v-if="result" class="mt-4" variant="outlined">
          <v-card-text class="ai-result">{{ result }}</v-card-text>
          <v-card-actions class="justify-end">
            <v-btn prepend-icon="mdi-content-copy" variant="text" @click="copyResult">
              {{ t("aiAssistant.copy") }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn variant="text" @click="dialogModel = false">{{ t("common.cancel") }}</v-btn>
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
  white-space: pre-wrap;
}
</style>
