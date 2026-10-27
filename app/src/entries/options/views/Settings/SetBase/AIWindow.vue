<script setup lang="ts">
import { onMounted, ref, shallowRef } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage } from "@/messages.ts";
import type { IMcpBridgeStatus } from "@/shared/mcpBridge.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import SettingsSection from "./SettingsSection.vue";

const { t } = useI18n();
const configStore = useConfigStore();
const status = shallowRef<IMcpBridgeStatus | null>(null);
const testState = ref<"idle" | "testing" | "success" | "error">("idle");
const testMessage = ref("");

async function refreshStatus() {
  try {
    status.value = await sendMessage("getMcpBridgeStatus", undefined);
  } catch (error) {
    status.value = {
      enabled: configStore.mcp.enabled,
      connected: false,
      status: "error",
      capabilities: [],
      lastError: error instanceof Error ? error.message : t("aiAssistant.testFailed"),
    };
  }
}

async function beforeSave() {
  await configStore.$save();
}

async function testConnection() {
  testState.value = "testing";
  testMessage.value = "";
  try {
    await beforeSave();
    status.value = await sendMessage("testMcpBridge", undefined);
    if (status.value.connected) {
      testState.value = "success";
      testMessage.value = t("aiAssistant.testSuccess");
    } else {
      testState.value = "error";
      testMessage.value = status.value.lastError || t("aiAssistant.testFailed");
    }
  } catch (error) {
    testState.value = "error";
    testMessage.value = error instanceof Error ? error.message : t("aiAssistant.testFailed");
  }
}

defineExpose({ beforeSave });
onMounted(refreshStatus);
</script>

<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('aiAssistant.title')"
      :description="t('aiAssistant.description')"
      icon="mdi-robot-outline"
    >
      <v-alert class="mb-4" density="compact" type="info" variant="tonal">
        {{ t("aiAssistant.privacyNotice") }}
      </v-alert>

      <v-switch
        v-model="configStore.mcp.enabled"
        :label="t('aiAssistant.enabled')"
        color="success"
        hide-details
      />

      <v-text-field
        v-model="configStore.mcp.bridgeUrl"
        :label="t('aiAssistant.bridgeUrl')"
        :messages="t('aiAssistant.bridgeUrlHint')"
        class="mt-4"
        clearable
        hide-details="auto"
        placeholder="http://127.0.0.1:19799"
      />

      <v-text-field
        v-model="configStore.mcp.bridgeToken"
        :label="t('aiAssistant.bridgeToken')"
        :messages="t('aiAssistant.bridgeTokenHint')"
        autocomplete="off"
        class="mt-3"
        clearable
        hide-details="auto"
        type="password"
      />

      <v-number-input
        v-model="configStore.mcp.timeoutMs"
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
        <v-chip v-if="status" :color="status.connected ? 'success' : 'grey'" size="small" variant="tonal">
          {{ status.connected ? t("aiAssistant.bridgeConnected") : t("aiAssistant.bridgeDisconnected") }}
        </v-chip>
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
