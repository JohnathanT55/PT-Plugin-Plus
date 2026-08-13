import { createRouter, createWebHashHistory, type RouteRecordRaw } from "vue-router";

export const setBaseChildren: RouteRecordRaw[] = [
  {
    path: "",
    alias: "ui",
    name: "SetBaseGeneral",
    meta: { icon: "mdi-cog", tabKey: "general" },
    component: () => import("../views/Settings/SetBase/GeneralWindow.vue"),
  },
  {
    path: "toolbar",
    name: "SetBaseToolbar",
    meta: { icon: "mdi-dock-right", tabKey: "toolbar" },
    component: () => import("../views/Settings/SetBase/ToolbarWindow.vue"),
  },
  {
    path: "browser-integration",
    name: "SetBaseBrowserIntegration",
    meta: { icon: "mdi-puzzle-outline", tabKey: "browserIntegration" },
    component: () => import("../views/Settings/SetBase/BrowserIntegrationWindow.vue"),
  },
  {
    path: "user-data",
    alias: "user-info",
    name: "SetBaseUserData",
    meta: { icon: "mdi-database-clock", tabKey: "userData" },
    component: () => import("../views/Settings/SetBase/UserDataWindow.vue"),
  },
  {
    path: "search",
    alias: "search-entity",
    name: "SetBaseSearch",
    meta: { icon: "mdi-magnify", tabKey: "search" },
    component: () => import("../views/Settings/SetBase/SearchEntityWindow.vue"),
  },
  {
    path: "download",
    name: "SetBaseDownload",
    meta: { icon: "mdi-cloud-download", tabKey: "download" },
    component: () => import("../views/Settings/SetBase/DownloadWindow.vue"),
  },
  {
    path: "backup",
    alias: "advanced",
    name: "SetBaseAdvanced",
    meta: { icon: "mdi-shield-sync", tabKey: "backup" },
    component: () => import("../views/Settings/SetBase/BackupWindow.vue"),
  },
] as const;

export const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Overview",
    meta: { isMainMenu: true },
    children: [
      {
        path: "/my-data",
        name: "MyData",
        alias: "",
        meta: { icon: "mdi-view-dashboard" },
        component: () => import("../views/Overview/MyData/Index.vue"),
      },
      {
        path: "/search-entity",
        name: "SearchEntity",
        meta: { icon: "mdi-magnify" },
        component: () => import("../views/Overview/SearchEntity/Index.vue"),
      },
      {
        path: "/search-result-snapshot",
        name: "SearchResultSnapshot",
        meta: { icon: "mdi-camera-plus" },
        component: () => import("../views/Overview/SearchResultSnapshot/Index.vue"),
      },
      {
        path: "/download-history",
        name: "DownloadHistory",
        meta: { icon: "mdi-history" },
        component: () => import("../views/Overview/DownloadHistory/Index.vue"),
      },
      {
        path: "/my-collection",
        name: "MyCollection",
        meta: { icon: "mdi-heart" },
        component: () => import("../views/Overview/MyCollection/Index.vue"),
      },
      {
        path: "/keep-upload-task",
        name: "KeepUploadTask",
        meta: { icon: "mdi-merge" },
        component: () => import("../views/Overview/KeepUploadTask/Index.vue"),
      },
    ],
  },
  {
    path: "/settings",
    name: "Settings",
    redirect: "/set-base",
    meta: { isMainMenu: true },
    children: [
      {
        path: "/set-downloader",
        name: "SetDownloader",
        meta: { icon: "mdi-cloud-download" },
        component: () => import("../views/Settings/SetDownloader/Index.vue"),
      },
      {
        path: "/set-base",
        name: "SetBase",
        meta: { icon: "mdi-cog" },
        component: () => import("../views/Settings/SetBase/Index.vue"),
        children: setBaseChildren,
      },
      {
        path: "/set-site",
        name: "SetSite",
        meta: { icon: "mdi-earth" },
        component: () => import("../views/Settings/SetSite/Index.vue"),
      },
      {
        path: "/set-download-paths",
        name: "SetDownloadPaths",
        meta: { icon: "mdi-folder-open" },
        component: () => import("../views/Settings/SetDownloadPaths/Index.vue"),
      },
      {
        path: "/set-search-solution",
        name: "SetSearchSolution",
        meta: { icon: "mdi-widgets" },
        component: () => import("../views/Settings/SetSearchSolution/Index.vue"),
      },
      {
        path: "/set-backup",
        name: "SetBackup",
        meta: { icon: "mdi-backup-restore" },
        component: () => import("../views/Settings/SetBackup/Index.vue"),
      },
    ],
  },
  {
    path: "/about",
    name: "About",
    meta: { isMainMenu: true, keepAlive: true },
    children: [
      {
        path: "/technology-stack",
        name: "TechnologyStack",
        meta: { icon: "mdi-developer-board" },
        component: () => import("../views/About/TechnologyStack.vue"),
      },
      {
        path: "/special-thank",
        name: "SpecialThank",
        meta: { icon: "mdi-account-multiple" },
        component: () => import("../views/About/SpecialThank.vue"),
      },
      {
        path: "/logger",
        name: "Logger",
        meta: { icon: "mdi-text-box-search" },
        component: () => import("../views/About/Logger.vue"),
      },
    ],
  },

  {
    path: "/user-data-timeline",
    name: "UserDataTimeline",
    meta: { isMainMenu: false },
    component: () => import("../views/Overview/MyData/UserDataTimeline/Index.vue"),
  },

  {
    path: "/user-data-statistic",
    name: "UserDataStatistic",
    meta: { isMainMenu: false },
    component: () => import("../views/Overview/MyData/UserDataStatistic/Index.vue"),
  },

  {
    path: "/link-push",
    name: "ContextMenuLinkPush",
    meta: { isMainMenu: false },
    component: () => import("../views/ContextMenuLinkPush.vue"),
  },

  { path: "/:pathMatch(.*)*", name: "NotFound", redirect: "/" },
];

export const routerInstance = createRouter({
  history: createWebHashHistory(),
  routes,
});
