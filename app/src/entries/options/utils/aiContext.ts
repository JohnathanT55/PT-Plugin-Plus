import { ref } from "vue";

import { sendMessage } from "@/messages.ts";
import type { IAiAssistRequest } from "@/shared/aiAssistant.ts";

export interface IAiPageContext {
  context?: IAiAssistRequest["context"];
  suggestions?: string[];
}

export const activeAiPageKey = ref("");
export const activeAiPageContext = ref<IAiPageContext>({});

export function setAiPageContext(key: string, value: IAiPageContext) {
  activeAiPageKey.value = key;
  activeAiPageContext.value = value;
  if (key === "SearchEntity" || key === "MyData") {
    void sendMessage("setMcpPageContext", {
      page: key === "SearchEntity" ? "search" : "my-data",
      context: value.context,
    }).catch(() => undefined);
  }
}

export function clearAiPageContext(key: string) {
  if (activeAiPageKey.value !== key) return;
  activeAiPageKey.value = "";
  activeAiPageContext.value = {};
  if (key === "SearchEntity" || key === "MyData") {
    void sendMessage("setMcpPageContext", {
      page: key === "SearchEntity" ? "search" : "my-data",
    }).catch(() => undefined);
  }
}
