<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from "vue";
import { useI18n } from "vue-i18n";
import { useLocale as useVuetifyLocal } from "vuetify";

import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { vuetifyLangMap } from "@/options/plugins/vuetify.ts";

import Navigation from "./views/Layout/Navigation.vue";
import Topbar from "./views/Layout/Topbar.vue";
import ReleaseNoteDialog from "./views/Layout/ReleaseNoteDialog.vue";

const { current: currentVuetifyLocal } = useVuetifyLocal();
const { locale: currentVueI18nLocal } = useI18n({ useScope: "global" });

const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();

watch(
  () => configStore.lang,
  (newLang) => {
    currentVueI18nLocal.value = newLang; // 修改 vue-i18n 的语言
    currentVuetifyLocal.value = vuetifyLangMap[newLang]; // 修改 vuetify 的语言
  },
  { immediate: true },
);

const uiScaleFactor = computed(() => configStore.uiScale / 100);
const uiScaleStyle = computed(() =>
  uiScaleFactor.value === 1
    ? undefined
    : {
        zoom: uiScaleFactor.value,
        minHeight: `${100 / uiScaleFactor.value}vh`,
      },
);
watchEffect(() => {
  document.documentElement.style.setProperty("--ptpp-ui-scale", String(uiScaleFactor.value));
  document.documentElement.classList.toggle("ptpp-ui-scaled", uiScaleFactor.value !== 1);
});
let uiScaleResizeFrame: number | undefined;
watch(
  uiScaleFactor,
  async () => {
    await nextTick();
    if (uiScaleResizeFrame !== undefined) cancelAnimationFrame(uiScaleResizeFrame);
    uiScaleResizeFrame = requestAnimationFrame(() => {
      uiScaleResizeFrame = undefined;
      window.dispatchEvent(new Event("resize"));
    });
  },
  { flush: "post" },
);

const showReleaseNoteDialog = ref<boolean>(false);
let externalLinkObserver: MutationObserver | undefined;

function secureBlankLinks(root: ParentNode = document) {
  root.querySelectorAll<HTMLAnchorElement>('a[target="_blank"]').forEach((anchor) => {
    const relTokens = new Set(anchor.rel.split(/\s+/).filter(Boolean));
    relTokens.add("noopener");
    relTokens.add("noreferrer");
    anchor.rel = [...relTokens].join(" ");
  });
}

onMounted(() => {
  secureBlankLinks();
  externalLinkObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "attributes" && mutation.target instanceof HTMLAnchorElement) {
        secureBlankLinks(mutation.target.parentNode ?? document);
      }
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLAnchorElement && node.target === "_blank")
          secureBlankLinks(node.parentNode ?? document);
        else if (node instanceof Element) secureBlankLinks(node);
      }
    }
  });
  externalLinkObserver.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["target"],
  });
});

onBeforeUnmount(() => {
  externalLinkObserver?.disconnect();
  document.documentElement.style.removeProperty("--ptpp-ui-scale");
  document.documentElement.classList.remove("ptpp-ui-scaled");
  if (uiScaleResizeFrame !== undefined) cancelAnimationFrame(uiScaleResizeFrame);
});

// 由于App.vue是整个应用的根组件，此时 configStore 等 pinia store 可能还未初始化完成，所以需要监听 $onReady
configStore.$onReady(() => {
  if (configStore.showReleaseNoteOnVersionChange && configStore.version !== __EXT_VERSION__) {
    showReleaseNoteDialog.value = true;
  }
});
</script>

<template>
  <v-app
    id="ptpp"
    :style="uiScaleStyle"
    :theme="configStore.uiTheme"
  >
    <!-- 顶部工具条 -->
    <Topbar />

    <!-- 导航栏 -->
    <Navigation />

    <v-main id="ptpp-main">
      <v-container fluid>
        <router-view v-slot="{ Component }">
          <component :is="Component" />
        </router-view>
      </v-container>
    </v-main>
  </v-app>

  <ReleaseNoteDialog v-model="showReleaseNoteDialog" />

  <v-snackbar-queue v-model="runtimeStore.uiGlobalSnakebar" closable />
</template>

<style scoped></style>
