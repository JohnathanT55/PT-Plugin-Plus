<script setup lang="ts">
import { computed, useTemplateRef } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { setBaseChildren } from "@/options/plugins/router.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const { t } = useI18n();
const router = useRouter();
const route = useRoute();
const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();

const setBaseTabs = setBaseChildren.map((x) => ({
  key: String(x.meta?.tabKey ?? x.path),
  route: x.name,
  icon: x.meta!.icon,
}));

const setTabRef = useTemplateRef<{ beforeSave?: () => Promise<void>; afterSave?: () => Promise<void> }>("setTabRef");

const activeTab = computed({
  get() {
    return route.name;
  },
  set(newRouteName) {
    router.push({ name: newRouteName });
  },
});

const showSaveButton = computed(() => {
  return route.meta?.usesGlobalSave !== false;
});

async function save() {
  await setTabRef.value?.beforeSave?.(); // 如果对应的 tab 有 afterSave 方法，则调用
  await configStore.$save();
  runtimeStore.showSnakebar(t("common.saveSuccess"), { color: "success" });
  await setTabRef.value?.afterSave?.(); // 如果对应的 tab 有 afterSave 方法，则调用
}
</script>

<template>
  <v-alert class="mb-3" :title="t('route.Settings.SetBase')" density="compact" type="info" variant="tonal" />
  <v-card class="ptpp-settings-shell" variant="outlined">
    <v-tabs v-model="activeTab" align-tabs="start" color="primary" show-arrows>
      <v-tab v-for="tab in setBaseTabs" :key="tab.key as string" :value="tab.route">
        <v-icon :icon="tab.icon as string" start />
        {{ t(`SetBase.tab.${tab.key}`) }}
      </v-tab>
    </v-tabs>
    <v-divider />
    <v-window v-model="activeTab">
      <v-card flat>
        <v-card-text class="settings-content pa-4 pa-md-6">
          <router-view v-slot="{ Component }">
            <component :is="Component" ref="setTabRef" />
          </router-view>
        </v-card-text>
        <v-divider v-if="showSaveButton" />
        <v-card-actions v-if="showSaveButton" class="settings-save-bar justify-end px-6 py-3">
          <v-btn color="success" min-width="120" prepend-icon="mdi-content-save-check" variant="elevated" @click="save">
            {{ t("common.save") }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-window>
  </v-card>
</template>

<style scoped lang="scss">
.ptpp-settings-shell {
  overflow: hidden;
}

.settings-content {
  min-height: 420px;
  background: rgba(var(--v-theme-surface-variant), 0.12);
}

.settings-save-bar {
  background: rgb(var(--v-theme-surface));
}
</style>
