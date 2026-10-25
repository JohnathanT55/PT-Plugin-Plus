<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage } from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const apiKey = ref("");
const testState = ref<"idle" | "testing" | "success" | "error">("idle");
const testMessage = ref("");

async function loadSecret() {
  apiKey.value = String((await sendMessage("getExtStorage", "aiAssistantSecret")) ?? "");
}

async function beforeSave() {
  await sendMessage("setExtStorage", { key: "aiAssistantSecret", value: apiKey.value.trim() });
}

async function testConnection() {
  testState.value = "testing";
  testMessage.value = "";
  try {
    await beforeSave();
    await configStore.$save();
    const result = await sendMessage("runAiAssistant", { mode: "test" });
    testState.value = "success";
    testMessage.value = result.text;
  } catch (error) {
    testState.value = "error";
    testMessage.value = error instanceof Error ? error.message : t("aiAssistant.testFailed");
  }
}

defineExpose({ beforeSave });
onMounted(loadSecret);
</script>

<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('aiAssistant.title')"
      :description="t('aiAssistant.description')"
      icon="mdi-robot-outline"
    >
      <v-alert class="mb-4" density="compact" type="warning" variant="tonal">
        {{ t("aiAssistant.privacyNotice") }}
      </v-alert>

      <v-switch
        v-model="configStore.aiAssistant.enabled"
        :label="t('aiAssistant.enabled')"
        color="success"
        hide-details
      />

      <v-text-field
        v-model="configStore.aiAssistant.endpoint"
        :label="t('aiAssistant.endpoint')"
        :messages="t('aiAssistant.endpointHint')"
        class="mt-4"
        clearable
        hide-details="auto"
        placeholder="https://example.com/v1"
      />

      <v-text-field
        v-model="configStore.aiAssistant.model"
        :label="t('aiAssistant.model')"
        class="mt-3"
        clearable
        hide-details
        placeholder="gpt-4o-mini"
      />

      <v-text-field
        v-model="apiKey"
        :label="t('aiAssistant.apiKey')"
        :messages="t('aiAssistant.apiKeyHint')"
        autocomplete="off"
        class="mt-3"
        clearable
        hide-details="auto"
        type="password"
      />

      <v-number-input
        v-model="configStore.aiAssistant.timeoutMs"
        :label="t('aiAssistant.timeout')"
        :max="60000"
        :min="1000"
        class="mt-3"
        controlVariant="default"
        hide-details
      />

      <div class="d-flex align-center flex-wrap ga-3 mt-4">
        <v-btn
          :loading="testState === 'testing'"
          color="primary"
          prepend-icon="mdi-connection"
          variant="tonal"
          @click="testConnection"
        >
          {{ t("aiAssistant.test") }}
        </v-btn>
        <v-alert
          v-if="testState !== 'idle'"
          :type="testState === 'success' ? 'success' : 'error'"
          density="compact"
          variant="tonal"
        >
          {{ testMessage || (testState === "success" ? t("aiAssistant.testSuccess") : t("aiAssistant.testFailed")) }}
        </v-alert>
      </div>
    </SettingsSection>
  </div>
</template>

<style scoped lang="scss">
.settings-stack {
  max-width: 1100px;
}
</style>
