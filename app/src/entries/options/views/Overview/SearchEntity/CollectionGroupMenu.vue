<script setup lang="ts">
import { nextTick, onBeforeUnmount, ref, watch, type CSSProperties } from "vue";
import { useI18n } from "vue-i18n";

import { sendMessage, type IPtppCollectionGroup } from "@/messages.ts";
import { useRuntimeStore } from "@/options/stores/runtime.ts";

const props = defineProps<{
  disabled?: boolean;
  title: string;
}>();

const emit = defineEmits<{
  (event: "select", groupId: string): void;
}>();

const GROUP_COLORS = [
  "red",
  "pink",
  "purple",
  "indigo",
  "blue",
  "cyan",
  "teal",
  "green",
  "amber",
  "orange",
  "deep-orange",
  "brown",
  "blue-grey",
];

const { t } = useI18n();
const runtimeStore = useRuntimeStore();
const anchor = ref<HTMLElement>();
const menu = ref<HTMLElement>();
const teleportTarget = ref<HTMLElement | ShadowRoot>();
const menuStyle = ref<CSSProperties>({});
const showMenu = ref(false);
const loading = ref(false);
const groups = ref<IPtppCollectionGroup[]>([]);

function updateMenuPosition() {
  const rect = anchor.value?.getBoundingClientRect();
  if (!rect) return;
  menuStyle.value = {
    right: `${Math.max(8, window.innerWidth - rect.right)}px`,
    top: `${Math.max(8, rect.bottom + 5)}px`,
  };
}

function closeMenu() {
  showMenu.value = false;
}

async function openGroupMenu() {
  if (props.disabled) return;
  if (showMenu.value) {
    closeMenu();
    return;
  }

  loading.value = true;
  try {
    const state = await sendMessage("getPtppCollectionState", undefined);
    groups.value = state.groups.filter((group): group is IPtppCollectionGroup & { id: string } => Boolean(group.id));
    const root = anchor.value?.getRootNode();
    teleportTarget.value = root instanceof ShadowRoot ? root : document.body;
    updateMenuPosition();
    showMenu.value = true;
    await nextTick();
    menu.value?.querySelector<HTMLElement>(".ptpp-collection-group-menu__item")?.focus();
  } catch (error) {
    runtimeStore.showSnakebar(`${t("MyCollection.loadFailed")}: ${String(error)}`, { color: "error" });
  } finally {
    loading.value = false;
  }
}

function selectGroup(groupId: string) {
  closeMenu();
  emit("select", groupId);
}

async function createAndSelectGroup() {
  closeMenu();
  const name = window.prompt(t("MyCollection.groupNamePrompt"));
  if (!name?.trim()) return;

  loading.value = true;
  try {
    const existingIds = new Set(groups.value.map((group) => group.id));
    const state = await sendMessage("createPtppCollectionGroup", {
      name: name.trim(),
      color: GROUP_COLORS[groups.value.length % GROUP_COLORS.length],
    });
    const created = state.groups.find((group) => group.id && !existingIds.has(group.id));
    if (!created?.id) throw new Error("Favorite group was not created");
    emit("select", created.id);
  } catch (error) {
    runtimeStore.showSnakebar(String(error), { color: "error" });
  } finally {
    loading.value = false;
  }
}

function closeOnOutsidePointer(event: Event) {
  const path = event.composedPath();
  if (anchor.value && !path.includes(anchor.value) && (!menu.value || !path.includes(menu.value))) closeMenu();
}

function closeOnEscape(event: KeyboardEvent) {
  if (event.key !== "Escape") return;
  event.preventDefault();
  closeMenu();
  anchor.value?.querySelector<HTMLElement>("button")?.focus();
}

watch(showMenu, (open) => {
  if (open) {
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    window.addEventListener("keydown", closeOnEscape, true);
    window.addEventListener("resize", closeMenu, true);
    window.addEventListener("scroll", closeMenu, true);
  } else {
    document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
    window.removeEventListener("keydown", closeOnEscape, true);
    window.removeEventListener("resize", closeMenu, true);
    window.removeEventListener("scroll", closeMenu, true);
  }
});

onBeforeUnmount(() => {
  document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
  window.removeEventListener("keydown", closeOnEscape, true);
  window.removeEventListener("resize", closeMenu, true);
  window.removeEventListener("scroll", closeMenu, true);
});
</script>

<template>
  <div ref="anchor" class="ptpp-collection-group-menu__anchor">
    <slot name="activator" :disabled="disabled" :loading="loading" :open-menu="openGroupMenu" />

    <Teleport v-if="teleportTarget" :to="teleportTarget">
      <div
        v-if="showMenu"
        ref="menu"
        class="ptpp-collection-group-menu"
        :style="menuStyle"
        role="menu"
        :aria-label="title"
      >
        <button
          v-for="group in groups"
          :key="group.id"
          class="ptpp-collection-group-menu__item"
          type="button"
          role="menuitem"
          @click="selectGroup(group.id!)"
        >
          <v-icon icon="mdi-folder-heart" size="20" />
          <span>{{ group.name }}</span>
          <small>{{ group.count ?? 0 }}</small>
        </button>
        <div v-if="groups.length" class="ptpp-collection-group-menu__divider" />
        <button
          class="ptpp-collection-group-menu__item ptpp-collection-group-menu__item--create"
          type="button"
          role="menuitem"
          @click="createAndSelectGroup"
        >
          <v-icon icon="mdi-folder-plus" size="20" />
          <span>{{ t("MyCollection.addGroup") }}</span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style scoped lang="scss">
.ptpp-collection-group-menu__anchor {
  display: inline-flex;
  position: relative;
}

.ptpp-collection-group-menu {
  background: #f3f8fc;
  border: 1px solid #b9d4e8;
  border-radius: 3px;
  box-shadow: 0 5px 15px rgb(0 0 0 / 28%);
  color: #194f77;
  display: flex;
  flex-direction: column;
  max-height: min(60vh, 420px);
  min-width: min(280px, calc(100vw - 32px));
  overflow-y: auto;
  padding: 4px 0;
  position: fixed;
  width: 320px;
  z-index: 3000;
}

.ptpp-collection-group-menu__item {
  align-items: center;
  appearance: none;
  background: transparent;
  border: 0;
  color: #194f77;
  cursor: pointer;
  display: grid;
  font:
    13px/1.35 Arial,
    "Microsoft YaHei",
    sans-serif;
  gap: 9px;
  grid-template-columns: 22px minmax(0, 1fr) auto;
  min-height: 40px;
  padding: 7px 12px;
  text-align: left;
  width: 100%;

  &:hover,
  &:focus-visible {
    background: #dcecf7;
    outline: none;
  }

  small {
    color: #38769f;
  }
}

.ptpp-collection-group-menu__item--create {
  color: #1f6b38;
  grid-template-columns: 22px minmax(0, 1fr);
  font-weight: 600;
}

.ptpp-collection-group-menu__divider {
  border-top: 1px solid #b9d4e8;
  margin: 4px 0;
}
</style>
