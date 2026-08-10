<script setup lang="ts">
import { computed, inject, nextTick, provide, ref, useTemplateRef, withModifiers } from "vue";
import { useI18n } from "vue-i18n";
import { useDraggable } from "@vueuse/core";
import { type ITorrent } from "@ptd/site";

import { sendMessage } from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { sendTorrentAssignments } from "@/options/components/SentToDownloaderDialog/utils.ts";
import { resolveSiteDownloadTarget } from "@/shared/downloadTarget.ts";

import { currentView, type IPtdData, pageType, updatePageType } from "./utils.ts";

import DownloadTargetMenu from "@/options/components/DownloadTargetMenu.vue";

const configStore = useConfigStore();
const runtimeStore = useRuntimeStore();
const metadataStore = useMetadataStore();
const { t } = useI18n();

const ptppIcon = chrome.runtime.getURL("icons/logo/64.png");
const ptdData = inject<IPtdData>("ptd_data", {});

const el = useTemplateRef<HTMLElement>("el");
const dragHandle = useTemplateRef<HTMLElement>("dragHandle");
provide("app", el);

// 记录一下与右边界和下边界的距离
const rightX = ref<number>(0);
const bottomY = ref<number>(0);

const { x, y, style } = useDraggable(el, {
  handle: dragHandle,
  preventDefault: true,
  initialValue: { x: -100, y: -100 }, // Default position off-screen
  onEnd: ({ x, y }) => {
    configStore.updateContentScriptPosition(x, y);
    const { clientWidth, clientHeight } = document.documentElement;
    rightX.value = clientWidth - x;
    bottomY.value = clientHeight - y;
  },
});

// 监听窗口大小变化，更新位置
window.addEventListener("resize", () => {
  const { clientWidth, clientHeight } = document.documentElement;

  x.value = clientWidth - rightX.value; // 右侧吸附
  if (x.value > clientWidth - 50 || x.value < 0) {
    x.value = clientWidth - 100; // 确保不会超出右边界
  }
  rightX.value = clientWidth - x.value;

  y.value = clientHeight - bottomY.value; // 底部吸附
  if (y.value > clientHeight - 50 || y.value < 0) {
    y.value = clientHeight - 100; // 确保不会超出下边界
  }
  bottomY.value = clientHeight - y.value;
});

// 由于App.vue是整个应用的根组件，此时 configStore 等 pinia store 可能还未初始化完成，所以需要监听 $onReady
configStore.$onReady(() => {
  updatePageType(ptdData).catch();

  let { x: storeX = -100, y: storeY = -100 } = configStore.contentScript?.position ?? {};
  let { clientWidth, clientHeight } = document.documentElement;

  x.value = storeX <= 0 || storeX > clientWidth - 80 ? clientWidth - 90 : storeX; // Default to right side
  y.value = storeY <= 0 || storeY > clientHeight - 80 ? Math.max(12, (clientHeight - 430) / 2) : storeY;
  rightX.value = clientWidth - x.value;
  bottomY.value = clientHeight - y.value;
});

function resetToolbarPosition() {
  const { clientWidth, clientHeight } = document.documentElement;
  x.value = clientWidth - 90;
  y.value = Math.max(12, (clientHeight - 430) / 2);
  rightX.value = clientWidth - x.value;
  bottomY.value = clientHeight - y.value;
  configStore.updateContentScriptPosition(x.value, y.value);
}

const manualDownloadTorrents = ref<ITorrent[]>([]);
const downloadTargetMenu = ref<InstanceType<typeof DownloadTargetMenu>>();

const CUSTOM_DRAG_MIME = "text/json+ptpp";

const isDragging = ref<boolean>(false);

function fixDraggingLink(link: string): string {
  if (!link.startsWith("http") && !link.startsWith("magnet:")) {
    return new URL(link, window.location.href).href; // 相对链接转换为绝对链接
  }
  return link;
}

document.addEventListener("dragstart", (e: DragEvent) => {
  const target = e.target as HTMLElement;
  if (target.tagName == "A") {
    const a = target as HTMLAnchorElement;
    const link = fixDraggingLink(a.href);
    if (link) {
      let list: ITorrent[] = [
        {
          site: ptdData.siteId || "",
          link,
          title: a.getAttribute("title") || target.innerText,
          id: getIDFromURL(URL.parse(link, location.href)),
        },
      ];
      e.dataTransfer?.setData(CUSTOM_DRAG_MIME, JSON.stringify(list));
    }
  }
  // fallback to default text/html behavior
});

const SIMPLE_URL_REGEX = /https?:\/\/[^\s]+/g;

function extractLinksManually(dataTransfer: DataTransfer): string[] {
  // prefer types: uri-list > html > text
  // ref: [MDN - Recommended_drag_types](https://developer.mozilla.org/en-US/docs/Web/API/HTML_Drag_and_Drop_API/Recommended_drag_types#dragging_links)
  if (Array.from(dataTransfer.types).includes("text/uri-list")) {
    const uriList = dataTransfer.getData("text/uri-list");
    if (uriList) {
      return uriList
        .split("\r\n")
        .map((line) => line.trim())
        .filter((uri) => !uri.startsWith("#") && uri.startsWith("http"));
    }
  }
  /**
   * 可以很好的适配<p><a href="...">...</a></p>这种情况
   * TODO: 但是面对选了一大片html的时候，可能会解析出来很多不是下载的链接，是否需要给每个站点/框架定义下载链接的正则表达式？
   * 比如简单的过滤 nexusphp => /passkey=[a-zA-Z0-9-]+/
   */
  if (dataTransfer.types.includes("text/html")) {
    const textData = dataTransfer.getData("text/html");
    if (textData) {
      const parser = new DOMParser();
      const doc = parser.parseFromString(textData, "text/html");
      const links = Array.from(doc.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href);
      return links.filter((link) => link.startsWith("http") || link.startsWith("magnet:"));
    }
  }
  // fallback to plain text extraction
  if (dataTransfer.types.includes("text/plain")) {
    const textData = dataTransfer.getData("text/plain");
    if (textData) {
      return Array.from(
        textData
          .matchAll(SIMPLE_URL_REGEX)
          .map((matched) => matched[0])
          .filter((url) => URL.canParse(url)),
      );
    }
  }
  return [];
}

function getIDFromURL(url?: URL | null): string {
  if (!url) return "";
  // 尝试从 searchParams 中提取 id
  for (const i of ["id", "tid", "torrent_id", "torrentId", "hash", "hash_id"]) {
    if (url.searchParams.has(i)) {
      return url.searchParams.get(i) || "";
    }
  }
  // 如果无法从 searchParams 中解出 id，则尝试从 pathname 中提取 id
  if (url.pathname) {
    for (const pathnameMatcher of [/\/(\d+)(?:\/|$)/]) {
      const match = url.pathname.match(pathnameMatcher);
      if (match) {
        return match[1] || "";
      }
    }
  }
  return "";
}

async function onDrop(event: DragEvent) {
  const dataTransfer = event.dataTransfer;
  if (!dataTransfer) {
    isDragging.value = false;
    return;
  }
  let torrents: ITorrent[] = [];
  // perfer types: custom > manual
  if (Array.from(dataTransfer.types).includes(CUSTOM_DRAG_MIME)) {
    try {
      torrents = JSON.parse(dataTransfer.getData(CUSTOM_DRAG_MIME));
    } catch (error) {
      console.warn("[PTPP] Failed to parse dropped data as JSON:", error);
    }
  } else {
    // 尝试从其他类型中提取链接
    const links = extractLinksManually(dataTransfer);
    for (const link of links) {
      const url = URL.parse(link);
      if (!url || !(url.protocol.startsWith("http") || url.protocol.startsWith("magnet"))) continue;
      const torrentData: ITorrent = { link, title: "", site: ptdData.siteId || "", id: getIDFromURL(url) };
      torrents.push(torrentData);
    }
  }
  if (torrents.length > 0) {
    const assignments = torrents.map((torrent) => ({
      torrent,
      target: resolveSiteDownloadTarget(metadataStore, torrent.site || ptdData.siteId),
    }));
    if (assignments.every(({ target }) => !target.requiresSelection && target.downloaderId && target.downloader)) {
      await sendTorrentAssignments(
        assignments.map(({ torrent, target }) => ({
          torrent,
          downloaderId: target.downloaderId!,
          addTorrentOptions: {
            localDownload: true,
            addAtPaused: !target.autoStart,
            savePath: target.savePath,
            label: target.label,
            uploadSpeedLimit: 0,
            advanceAddTorrentOptions: target.downloader?.advanceAddTorrentOptions ?? {},
          },
        })),
      );
    } else {
      manualDownloadTorrents.value = torrents;
      await nextTick();
      await downloadTargetMenu.value?.openTargetMenu();
    }
  } else {
    console.warn("[PTPP] No valid torrent data found in the dropped content.");
  }
  isDragging.value = false; // 重置拖拽状态
}

const dropAction = computed(() => {
  if (ptdData.siteId && (configStore.contentScript?.dragLinkOnSpeedDial ?? true)) {
    return {
      drop: withModifiers((e) => void onDrop(e as DragEvent), ["prevent"]),
      dragover: withModifiers(() => (isDragging.value = true), ["prevent"]),
      dragenter: () => withModifiers(() => (isDragging.value = true), ["prevent"]),
      // dragleave 和 mouseleave 事件直接使用 vue 的普通注册方式，而不是用 对象方式（因为不会有任何副作用）
    };
  }
  return {};
});

function openOptions() {
  sendMessage("openOptionsPage", "/");
}
</script>

<template>
  <v-theme-provider theme="">
    <div
      ref="el"
      :style="style"
      class="ptpp-toolbar"
      @mouseleave.prevent="isDragging = false"
      @dragleave.prevent="isDragging = false"
      v-on="dropAction"
    >
      <div
        ref="dragHandle"
        class="ptpp-toolbar-drag-handle"
        :title="t('contentScript.dragTitle')"
        @dblclick="resetToolbarPosition"
      />
      <button class="ptpp-toolbar-logo" type="button" :title="t('contentScript.openPTD')" @click="openOptions">
        <img :class="{ 'ptpp-toolbar-logo-loading': isDragging }" :src="ptppIcon" alt="PT-Plugin-Plus" />
      </button>

      <!-- PTPP 原版默认常驻显示全部可用操作。 -->
      <component :is="currentView" :key="pageType" />

      <DownloadTargetMenu
        ref="downloadTargetMenu"
        placement="top-end"
        :title="t('contentScript.pushTo')"
        :torrent-items="manualDownloadTorrents"
      />
    </div>

    <v-snackbar-queue v-model="runtimeStore.uiGlobalSnakebar" closable :attach="true" />
  </v-theme-provider>
</template>

<style scoped lang="scss">
.ptpp-toolbar {
  background: aliceblue;
  border-radius: 8px;
  box-shadow: 0 2px 10px rgba(0, 0, 0, 0.12);
  box-sizing: border-box;
  color: #1976d2;
  font-family: Arial, "Microsoft YaHei", sans-serif;
  opacity: 0.32;
  overflow: visible;
  padding-bottom: 5px;
  position: fixed;
  transition: opacity 120ms ease;
  width: 80px;
  z-index: 9999999;

  &:hover,
  &:focus-within {
    opacity: 0.94;
  }
}

.ptpp-toolbar-drag-handle {
  background: #ffc107;
  border-radius: 8px 8px 0 0;
  cursor: move;
  height: 8px;
  width: 100%;
}

.ptpp-toolbar-logo {
  appearance: none;
  background: transparent;
  border: 0;
  cursor: pointer;
  display: block;
  margin: 5px auto;
  padding: 0;

  img {
    display: block;
    height: 34px;
    opacity: 0.75;
    width: 34px;
  }
}

.ptpp-toolbar-logo-loading {
  animation: ptpp-logo-loading 1.2s linear infinite;
}

@keyframes ptpp-logo-loading {
  to {
    transform: rotate(360deg);
  }
}
</style>
