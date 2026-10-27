import { ref } from "vue";

import type { IAiAssistRequest } from "@/shared/aiAssistant.ts";

export interface IAiPageContext {
  context?: IAiAssistRequest["context"];
  suggestions?: string[];
}

const activeKey = ref("");
export const activeAiPageContext = ref<IAiPageContext>({});

export function setAiPageContext(key: string, value: IAiPageContext) {
  activeKey.value = key;
  activeAiPageContext.value = value;
}

export function clearAiPageContext(key: string) {
  if (activeKey.value !== key) return;
  activeKey.value = "";
  activeAiPageContext.value = {};
}
