<script setup lang="ts">
import type { TMarkdownInlineNode } from "./markdown.ts";

defineProps<{ nodes: TMarkdownInlineNode[] }>();
</script>

<template>
  <template v-for="(node, index) in nodes" :key="`${node.type}-${index}`">
    <template v-if="node.type === 'text'">{{ node.value }}</template>
    <br v-else-if="node.type === 'break'" />
    <code v-else-if="node.type === 'code'">{{ node.value }}</code>
    <strong v-else-if="node.type === 'strong'"><MarkdownInline :nodes="node.children" /></strong>
    <em v-else-if="node.type === 'emphasis'"><MarkdownInline :nodes="node.children" /></em>
    <a v-else-if="node.type === 'link'" :href="node.href" rel="noreferrer noopener" target="_blank">
      <MarkdownInline :nodes="node.label" />
    </a>
  </template>
</template>
