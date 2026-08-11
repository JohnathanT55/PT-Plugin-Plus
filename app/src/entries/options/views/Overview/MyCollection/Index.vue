<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import type { DataTableHeader } from "vuetify";
import type { ITorrent, TSiteID } from "@ptd/site";

import {
  sendMessage,
  type IPtppCollectionGroup,
  type IPtppCollectionItem,
  type IPtppCollectionState,
} from "@/messages.ts";
import { useConfigStore } from "@/options/stores/config.ts";
import { useMetadataStore } from "@/options/stores/metadata.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";
import { formatDate, formatSize } from "@/options/utils.ts";
import NavButton from "@/options/components/NavButton.vue";
import SiteFavicon from "@/options/components/SiteFavicon/Index.vue";
import SiteName from "@/options/components/SiteName.vue";
import ActionTd from "@/options/views/Overview/SearchEntity/ActionTd.vue";
import GroupCard from "./GroupCard.vue";

const ALL_GROUP = "__all__";
const NO_GROUP = "__no_group__";
const GROUP_COLORS: string[] = [
  "red",
  "pink",
  "purple",
  "deep-purple",
  "indigo",
  "blue",
  "light-blue",
  "cyan",
  "teal",
  "green",
  "light-green",
  "lime",
  "amber",
  "orange",
  "deep-orange",
  "brown",
  "blue-grey",
  "grey",
];

const { t } = useI18n();
const router = useRouter();
const configStore = useConfigStore();
const metadataStore = useMetadataStore();
const runtimeStore = useRuntimeStore();

const collection = ref<IPtppCollectionState>({ groups: [], items: [] });
const loading = ref(false);
const activeGroupId = ref(ALL_GROUP);
const selectedLinks = ref<string[]>([]);
const filter = ref("");

const headers = computed(
  () =>
    [
      { title: "№", key: "index", align: "center", width: 52, sortable: false },
      { title: t("MyCollection.headers.title"), key: "title", align: "start", minWidth: "34rem" },
      { title: t("MyCollection.headers.groups"), key: "groups", align: "start", minWidth: 180, sortable: false },
      { title: t("common.site"), key: "siteId", align: "center", minWidth: 105 },
      { title: t("MyCollection.headers.size"), key: "size", align: "end", width: 120 },
      { title: t("MyCollection.headers.time"), key: "time", align: "center", minWidth: 160 },
      { title: t("common.action"), key: "action", align: "center", minWidth: 270, sortable: false },
    ] as DataTableHeader[],
);

function itemSiteId(item: IPtppCollectionItem): TSiteID | undefined {
  if (item.siteId) return item.siteId as TSiteID;
  if (item.host) return metadataStore.siteHostMap[item.host] as TSiteID | undefined;
  return undefined;
}

function torrentId(item: IPtppCollectionItem): string {
  try {
    const url = new URL(item.link || item.url || "");
    return url.searchParams.get("id") || url.pathname.split("/").filter(Boolean).at(-1) || item.link || "collection";
  } catch {
    return item.link || item.url || "collection";
  }
}

function toTorrent(item: IPtppCollectionItem): ITorrent | null {
  const site = itemSiteId(item);
  if (!site) return null;
  const movieInfo = item.movieInfo ?? {};
  const torrent: ITorrent = {
    site,
    id: torrentId(item),
    title: item.title || item.link || item.url || t("MyCollection.untitled"),
    subTitle: item.subTitle,
    url: item.link,
    link: item.url,
    size: item.size,
    time: item.time,
  };
  const imdbId = item.imdbId || (typeof movieInfo.imdbId === "string" ? movieInfo.imdbId : undefined);
  const doubanId = typeof movieInfo.doubanId === "string" ? movieInfo.doubanId : undefined;
  if (imdbId) torrent.ext_imdb = imdbId;
  if (doubanId) torrent.ext_douban = doubanId;
  return torrent;
}

function itemMatchesGroup(item: IPtppCollectionItem, groupId: string): boolean {
  if (groupId === ALL_GROUP) return true;
  if (groupId === NO_GROUP) return !item.groups?.length;
  return item.groups?.includes(groupId) ?? false;
}

const groupItems = computed(() => collection.value.items.filter((item) => itemMatchesGroup(item, activeGroupId.value)));
const visibleItems = computed(() => {
  const words = filter.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groupItems.value;
  return groupItems.value.filter((item) => {
    const movieInfo = item.movieInfo ?? {};
    const source = [
      item.title,
      item.subTitle,
      item.host,
      item.siteId,
      movieInfo.title,
      movieInfo.alt_title,
      movieInfo.imdbId,
      movieInfo.doubanId,
    ]
      .filter(Boolean)
      .join(" ")
      .toLocaleLowerCase();
    return words.every((word) => source.includes(word));
  });
});

function torrentsFor(items: IPtppCollectionItem[]): ITorrent[] {
  return items.map(toTorrent).filter((item): item is ITorrent => Boolean(item));
}

const selectedItems = computed(() => {
  const links = new Set(selectedLinks.value);
  return collection.value.items.filter((item) => item.link && links.has(item.link));
});
const selectedTorrents = computed(() => torrentsFor(selectedItems.value));

const cards = computed(() => {
  const card = (id: string, name: string, items: IPtppCollectionItem[], color: string, readOnly: boolean) => ({
    id,
    name,
    items,
    color,
    readOnly,
    count: items.length,
    totalSize: items.reduce((sum, item) => sum + Number(item.size || 0), 0),
    torrentItems: torrentsFor(items),
    isDefault: collection.value.defaultGroupId === id,
  });
  const ungrouped = collection.value.items.filter((item) => !item.groups?.length);
  return [
    card(ALL_GROUP, t("MyCollection.all"), collection.value.items, "grey", true),
    card(NO_GROUP, t("MyCollection.noGroup"), ungrouped, "blue-grey", true),
    ...collection.value.groups.map((group) =>
      card(
        group.id!,
        group.name || t("MyCollection.unnamedGroup"),
        collection.value.items.filter((item) => item.groups?.includes(group.id!)),
        group.color || "blue",
        false,
      ),
    ),
  ];
});

async function loadCollection() {
  loading.value = true;
  try {
    collection.value = await sendMessage("getPtppCollectionState", undefined);
    if (![ALL_GROUP, NO_GROUP, ...collection.value.groups.map((group) => group.id)].includes(activeGroupId.value)) {
      activeGroupId.value = ALL_GROUP;
    }
    selectedLinks.value = selectedLinks.value.filter((link) =>
      collection.value.items.some((item) => item.link === link),
    );
  } catch (error) {
    runtimeStore.showSnakebar(`${t("MyCollection.loadFailed")}: ${String(error)}`, { color: "error" });
  } finally {
    loading.value = false;
  }
}

async function applyMutation(job: Promise<IPtppCollectionState>, success: string) {
  try {
    collection.value = await job;
    selectedLinks.value = [];
    runtimeStore.showSnakebar(success, { color: "success" });
  } catch (error) {
    runtimeStore.showSnakebar(String(error), { color: "error" });
  }
}

async function removeItems(items: IPtppCollectionItem[]) {
  const links = items.map((item) => item.link).filter(Boolean) as string[];
  if (!links.length || !confirm(t("MyCollection.removeConfirm", { count: links.length }))) return;
  await applyMutation(sendMessage("removePtppCollectionItems", { links }), t("MyCollection.removed"));
}

async function clearAll() {
  if (!collection.value.items.length || !confirm(t("MyCollection.clearConfirm"))) return;
  await applyMutation(sendMessage("clearPtppCollection", undefined), t("MyCollection.cleared"));
  activeGroupId.value = ALL_GROUP;
}

const groupDialog = ref(false);
const editingGroupId = ref<string>();
const groupForm = ref({ name: "", color: "blue", description: "" });

function openAddGroup() {
  editingGroupId.value = undefined;
  groupForm.value = {
    name: "",
    color: GROUP_COLORS[collection.value.groups.length % GROUP_COLORS.length],
    description: "",
  };
  groupDialog.value = true;
}

function openEditGroup(groupId: string) {
  const group = collection.value.groups.find((item) => item.id === groupId);
  if (!group) return;
  editingGroupId.value = groupId;
  groupForm.value = { name: group.name || "", color: group.color || "blue", description: group.description || "" };
  groupDialog.value = true;
}

async function saveGroup() {
  if (!groupForm.value.name.trim()) return;
  const data = { ...groupForm.value, name: groupForm.value.name.trim() };
  const job = editingGroupId.value
    ? sendMessage("updatePtppCollectionGroup", { groupId: editingGroupId.value, patch: data })
    : sendMessage("createPtppCollectionGroup", data);
  await applyMutation(job, t("MyCollection.groupSaved"));
  groupDialog.value = false;
}

async function removeGroup(groupId: string) {
  const group = collection.value.groups.find((item) => item.id === groupId);
  if (!group || !confirm(t("MyCollection.removeGroupConfirm", { name: group.name, count: group.count || 0 }))) return;
  await applyMutation(sendMessage("deletePtppCollectionGroup", { groupId }), t("MyCollection.groupRemoved"));
  if (activeGroupId.value === groupId) activeGroupId.value = ALL_GROUP;
}

async function toggleDefaultGroup(groupId: string) {
  const next = collection.value.defaultGroupId === groupId ? undefined : groupId;
  await applyMutation(sendMessage("setPtppDefaultCollectionGroup", { groupId: next }), t("MyCollection.defaultSaved"));
}

async function toggleItemGroup(item: IPtppCollectionItem, groupId: string) {
  if (!item.link) return;
  const assigned = !item.groups?.includes(groupId);
  try {
    collection.value = await sendMessage("setPtppCollectionItemGroup", { link: item.link, groupId, assigned });
  } catch (error) {
    runtimeStore.showSnakebar(String(error), { color: "error" });
  }
}

const itemDialog = ref(false);
const editingItem = ref<IPtppCollectionItem>();
const itemForm = ref({ title: "", subTitle: "", imdbId: "", doubanId: "" });

function openEditItem(item: IPtppCollectionItem) {
  editingItem.value = item;
  const movieInfo = item.movieInfo ?? {};
  itemForm.value = {
    title: item.title || "",
    subTitle: item.subTitle || "",
    imdbId: item.imdbId || (typeof movieInfo.imdbId === "string" ? movieInfo.imdbId : ""),
    doubanId: typeof movieInfo.doubanId === "string" ? movieInfo.doubanId : "",
  };
  itemDialog.value = true;
}

async function saveItem() {
  if (!editingItem.value?.link || !itemForm.value.title.trim()) return;
  const movieInfo = { ...(editingItem.value.movieInfo ?? {}) };
  if (itemForm.value.imdbId.trim()) movieInfo.imdbId = itemForm.value.imdbId.trim();
  else delete movieInfo.imdbId;
  if (itemForm.value.doubanId.trim()) movieInfo.doubanId = itemForm.value.doubanId.trim();
  else delete movieInfo.doubanId;
  await applyMutation(
    sendMessage("updatePtppCollectionItem", {
      link: editingItem.value.link,
      patch: {
        title: itemForm.value.title,
        subTitle: itemForm.value.subTitle,
        imdbId: itemForm.value.imdbId,
        movieInfo,
      },
    }),
    t("MyCollection.itemSaved"),
  );
  itemDialog.value = false;
}

function searchItem(item: IPtppCollectionItem) {
  const movieInfo = item.movieInfo ?? {};
  const imdb = item.imdbId || (typeof movieInfo.imdbId === "string" ? movieInfo.imdbId : "");
  const keyword = imdb ? `imdb|${imdb}` : item.title || "";
  router.push({ name: "SearchEntity", query: { search: keyword, flush: Date.now() } });
}

function itemGroups(item: IPtppCollectionItem): IPtppCollectionGroup[] {
  const ids = new Set(item.groups ?? []);
  return collection.value.groups.filter((group) => group.id && ids.has(group.id));
}

onMounted(loadCollection);
</script>

<template>
  <v-alert type="info" :title="t('route.Overview.MyCollection')" />

  <section class="ptpp-collection-groups" :aria-label="t('MyCollection.groups')">
    <GroupCard
      v-for="card in cards"
      :key="card.id"
      v-bind="card"
      :active="activeGroupId === card.id"
      @select="(id) => (activeGroupId = id)"
      @edit="openEditGroup"
      @remove="removeGroup"
      @toggle-default="toggleDefaultGroup"
    />
  </section>

  <v-card class="ptpp-collection-table">
    <v-card-title class="ptpp-collection-toolbar">
      <div class="ptpp-collection-toolbar__actions">
        <NavButton
          :disabled="selectedItems.length === 0"
          color="error"
          icon="mdi-minus"
          :text="`${t('common.remove')} (${selectedItems.length})`"
          @click="removeItems(selectedItems)"
        />
        <NavButton
          :disabled="collection.items.length === 0"
          color="error"
          icon="mdi-delete-sweep"
          :text="t('MyCollection.clear')"
          @click="clearAll"
        />
        <NavButton color="success" icon="mdi-folder-plus" :text="t('MyCollection.addGroup')" @click="openAddGroup" />
        <NavButton
          color="primary"
          icon="mdi-help-circle"
          :text="t('MyCollection.help')"
          href="https://github.com/pt-plugins/PT-Plugin-Plus/wiki/my-collection"
          target="_blank"
        />
        <ActionTd
          v-if="selectedItems.length > 0"
          :torrent-items="selectedTorrents"
          density="compact"
          :show-favorite-btn="false"
          :show-keep-upload-btn="false"
          show-labels
        />
      </div>
      <v-spacer />
      <v-text-field
        v-model="filter"
        append-icon="mdi-magnify"
        clearable
        density="compact"
        hide-details
        :label="t('MyCollection.filter')"
        max-width="520"
        single-line
      />
    </v-card-title>

    <v-data-table
      v-model="selectedLinks"
      :headers="headers"
      :items="visibleItems"
      :items-per-page="configStore.tableBehavior.MyCollection?.itemsPerPage ?? 10"
      :loading="loading"
      :multi-sort="configStore.enableTableMultiSort"
      :sort-by="configStore.tableBehavior.MyCollection?.sortBy ?? [{ key: 'time', order: 'desc' }]"
      class="table-stripe table-header-no-wrap"
      hover
      item-value="link"
      show-select
      @update:items-per-page="(value) => configStore.updateTableBehavior('MyCollection', 'itemsPerPage', value)"
      @update:sort-by="(value) => configStore.updateTableBehavior('MyCollection', 'sortBy', value)"
    >
      <template #item.index="{ index }">
        {{ index + 1 }}
      </template>

      <template #item.title="{ item }">
        <div class="ptpp-collection-title">
          <a :href="item.link" target="_blank" rel="noopener noreferrer nofollow" :title="item.title">
            {{ item.title || item.link || item.url || t("MyCollection.untitled") }}
          </a>
          <small v-if="item.subTitle">{{ item.subTitle }}</small>
          <small v-if="item.movieInfo?.title || item.movieInfo?.alt_title" class="ptpp-collection-movie">
            {{ [item.movieInfo?.title, item.movieInfo?.alt_title].filter(Boolean).join(" / ") }}
          </small>
        </div>
      </template>

      <template #item.groups="{ item }">
        <div class="ptpp-collection-chips">
          <v-chip
            v-for="group in itemGroups(item)"
            :key="group.id"
            :color="group.color || 'grey'"
            closable
            label
            size="small"
            @click:close="toggleItemGroup(item, group.id!)"
          >
            {{ group.name }}
          </v-chip>
          <v-chip v-if="!itemGroups(item).length" color="grey" label size="small" variant="tonal">
            {{ t("MyCollection.noGroup") }}
          </v-chip>
          <v-menu :close-on-content-click="false">
            <template #activator="{ props }">
              <v-btn
                v-bind="props"
                icon="mdi-plus"
                size="x-small"
                variant="text"
                :title="t('MyCollection.addToGroup')"
              />
            </template>
            <v-list density="compact" min-width="220">
              <v-list-item v-if="!collection.groups.length" :title="t('MyCollection.noCustomGroups')" disabled />
              <v-list-item
                v-for="group in collection.groups"
                :key="group.id"
                :title="group.name"
                @click="toggleItemGroup(item, group.id!)"
              >
                <template #prepend>
                  <v-checkbox-btn :model-value="item.groups?.includes(group.id!)" />
                </template>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
      </template>

      <template #item.siteId="{ item }">
        <div v-if="itemSiteId(item)" class="d-flex flex-column align-center">
          <SiteFavicon :site-id="itemSiteId(item)!" :size="18" />
          <SiteName :site-id="itemSiteId(item)!" />
        </div>
        <span v-else>{{ item.host || "-" }}</span>
      </template>

      <template #item.size="{ item }">
        <span class="text-no-wrap">{{ item.size ? formatSize(item.size) : "-" }}</span>
      </template>

      <template #item.time="{ item }">
        <span class="text-no-wrap">{{ item.time ? formatDate(item.time) : "-" }}</span>
      </template>

      <template #item.action="{ item }">
        <div class="ptpp-collection-row-actions">
          <ActionTd
            :torrent-items="toTorrent(item) ? [toTorrent(item)!] : []"
            density="compact"
            :show-favorite-btn="false"
            :show-keep-upload-btn="false"
          />
          <v-btn
            color="primary"
            icon="mdi-magnify"
            size="small"
            variant="text"
            :title="t('common.search')"
            @click="searchItem(item)"
          />
          <v-btn
            color="blue"
            icon="mdi-pencil"
            size="small"
            variant="text"
            :title="t('common.edit')"
            @click="openEditItem(item)"
          />
          <v-btn
            color="error"
            icon="mdi-delete"
            size="small"
            variant="text"
            :title="t('common.remove')"
            @click="removeItems([item])"
          />
        </div>
      </template>

      <template #no-data>
        <div class="pa-6 text-medium-emphasis">{{ t("MyCollection.empty") }}</div>
      </template>
    </v-data-table>
  </v-card>

  <v-dialog v-model="groupDialog" max-width="540">
    <v-card>
      <v-toolbar
        color="primary"
        density="compact"
        :title="editingGroupId ? t('MyCollection.editGroup') : t('MyCollection.addGroup')"
      />
      <v-card-text class="pt-5">
        <v-text-field v-model="groupForm.name" :label="t('common.name')" autofocus />
        <v-select v-model="groupForm.color" :items="GROUP_COLORS" :label="t('MyCollection.groupColor')">
          <template #item="{ props, item }">
            <v-list-item v-bind="props">
              <template #prepend><v-icon icon="mdi-circle" :color="item.value" /></template>
            </v-list-item>
          </template>
        </v-select>
        <v-textarea v-model="groupForm.description" :label="t('MyCollection.groupDescription')" rows="2" />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="groupDialog = false">{{ t("common.dialog.cancel") }}</v-btn>
        <v-btn color="primary" :disabled="!groupForm.name.trim()" @click="saveGroup">{{ t("common.save") }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog v-model="itemDialog" max-width="680">
    <v-card>
      <v-toolbar color="primary" density="compact" :title="t('MyCollection.editItem')" />
      <v-card-text class="pt-5">
        <v-text-field v-model="itemForm.title" :label="t('MyCollection.headers.title')" autofocus />
        <v-text-field v-model="itemForm.subTitle" :label="t('MyCollection.subTitle')" />
        <v-row>
          <v-col cols="12" sm="6"><v-text-field v-model="itemForm.imdbId" label="IMDb ID" /></v-col>
          <v-col cols="12" sm="6"
            ><v-text-field v-model="itemForm.doubanId" :label="t('MyCollection.doubanId')"
          /></v-col>
        </v-row>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="itemDialog = false">{{ t("common.dialog.cancel") }}</v-btn>
        <v-btn color="primary" :disabled="!itemForm.title.trim()" @click="saveItem">{{ t("common.save") }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped lang="scss">
.ptpp-collection-groups {
  display: flex;
  gap: 12px;
  margin: 12px 0;
  overflow-x: auto;
  padding: 3px 3px 10px;
}

.ptpp-collection-table {
  border-radius: 0;
}

.ptpp-collection-toolbar {
  align-items: center;
  display: flex;
  gap: 12px;
  min-height: 58px;
}

.ptpp-collection-toolbar__actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.ptpp-collection-title {
  display: grid;
  gap: 2px;
  padding-block: 5px;

  a {
    color: rgb(var(--v-theme-primary));
    font-size: 14px;
    text-decoration: none;
  }

  small {
    color: rgb(var(--v-theme-on-surface), 0.65);
    line-height: 1.35;
  }
}

.ptpp-collection-movie {
  color: rgb(var(--v-theme-secondary)) !important;
}

.ptpp-collection-chips,
.ptpp-collection-row-actions {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.ptpp-collection-row-actions {
  flex-wrap: nowrap;
  justify-content: center;
}

@media (max-width: 960px) {
  .ptpp-collection-toolbar {
    align-items: stretch;
    flex-direction: column;
  }

  .ptpp-collection-group {
    flex-basis: 250px;
  }
}
</style>
