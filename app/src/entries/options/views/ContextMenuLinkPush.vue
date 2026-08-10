<script setup lang="ts">
/**
 * 本文件仅作为右键菜单的链接跳转使用
 */

import { nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { getHostFromUrl, ITorrent } from "@ptd/site";

import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

import DownloadTargetMenu from "@/options/components/DownloadTargetMenu.vue";

const route = useRoute();
const router = useRouter();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();
const { t } = useI18n();

const torrentItems = ref<ITorrent[]>([]);
const downloadTargetMenu = ref<InstanceType<typeof DownloadTargetMenu>>();

onMounted(() => {
  const link = route?.query?.link;

  if (!link || typeof link !== "string") {
    runtimeStore.showSnakebar(t("ContextMenuLinkPush.invalidLink"), { color: "error" });
    onCancel();
    return;
  }

  const torrent = { link } as ITorrent;

  // 尝试从 link 中解出site
  if (link.match(/https?:\/\/([^/]+)/)) {
    const host = getHostFromUrl(link);
    if (metadataStore.siteHostMap[host]) {
      torrent.site = metadataStore.siteHostMap[host];
    }
  }

  torrentItems.value = [torrent];
  runtimeStore.showSnakebar(t("ContextMenuLinkPush.keywordWarning"), { color: "warning" });
  metadataStore.$onReady(async () => {
    await nextTick();
    await downloadTargetMenu.value?.openTargetMenu();
  });
});

function onDone() {
  router.push({
    name: "DownloadHistory",
  });
}

function onCancel() {
  window.close();
}
</script>

<template>
  <main class="ptpp-context-link-push">
    <h1>{{ t("SearchEntity.ActionTd.sendToDownloader") }}</h1>
    <p>{{ t("ContextMenuLinkPush.keywordWarning") }}</p>
    <div class="ptpp-context-link-push__actions">
      <DownloadTargetMenu
        ref="downloadTargetMenu"
        :title="t('SearchEntity.ActionTd.sendToDownloader')"
        :torrent-items="torrentItems"
        @done="onDone"
      >
        <template #activator="{ disabled, loading, openMenu, status }">
          <v-btn
            :disabled="disabled"
            :loading="loading"
            color="primary"
            :prepend-icon="status === 'success' ? 'mdi-check' : status === 'error' ? 'mdi-close' : 'mdi-cloud-download'"
            @click="openMenu"
          >
            {{ t("SearchEntity.ActionTd.sendToDownloader") }}
          </v-btn>
        </template>
      </DownloadTargetMenu>
      <v-btn variant="text" @click="onCancel">{{ t("common.dialog.cancel") }}</v-btn>
    </div>
  </main>
</template>

<style scoped lang="scss">
.ptpp-context-link-push {
  background: #fff;
  border-top: 5px solid #1976d2;
  box-shadow: 0 2px 10px rgb(0 0 0 / 16%);
  margin: 40px auto;
  max-width: 680px;
  padding: 20px 24px 24px;

  h1 {
    color: #174f78;
    font-size: 20px;
    margin: 0 0 10px;
  }

  p {
    color: #546e7a;
    margin: 0 0 20px;
  }
}

.ptpp-context-link-push__actions {
  align-items: center;
  display: flex;
  gap: 8px;
}
</style>
