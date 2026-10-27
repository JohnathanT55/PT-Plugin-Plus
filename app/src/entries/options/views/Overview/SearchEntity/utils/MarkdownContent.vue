<script setup lang="ts">
import MarkdownInline from "./MarkdownInline.vue";
import { parseMarkdown } from "./markdown.ts";

const props = defineProps<{ source: string }>();
</script>

<template>
  <div class="markdown-content">
    <template v-for="(block, index) in parseMarkdown(props.source)" :key="`${block.type}-${index}`">
      <component :is="`h${block.level}`" v-if="block.type === 'heading'" class="markdown-heading">
        <MarkdownInline :nodes="block.children" />
      </component>
      <p v-else-if="block.type === 'paragraph'" class="markdown-paragraph">
        <MarkdownInline :nodes="block.children" />
      </p>
      <blockquote v-else-if="block.type === 'blockquote'" class="markdown-blockquote">
        <MarkdownInline :nodes="block.children" />
      </blockquote>
      <ul v-else-if="block.type === 'unordered-list'" class="markdown-list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex"><MarkdownInline :nodes="item" /></li>
      </ul>
      <ol v-else-if="block.type === 'ordered-list'" class="markdown-list">
        <li v-for="(item, itemIndex) in block.items" :key="itemIndex"><MarkdownInline :nodes="item" /></li>
      </ol>
      <div v-else-if="block.type === 'table'" class="markdown-table-wrap">
        <table class="markdown-table">
          <thead>
            <tr>
              <th v-for="(cell, cellIndex) in block.headers" :key="cellIndex"><MarkdownInline :nodes="cell" /></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="(row, rowIndex) in block.rows" :key="rowIndex">
              <td v-for="(cell, cellIndex) in row" :key="cellIndex"><MarkdownInline :nodes="cell" /></td>
            </tr>
          </tbody>
        </table>
      </div>
      <pre v-else-if="block.type === 'code'" class="markdown-code"><code>{{ block.value }}</code></pre>
      <hr v-else-if="block.type === 'hr'" />
    </template>
  </div>
</template>

<style scoped lang="scss">
.markdown-content {
  overflow-wrap: anywhere;
  line-height: 1.6;
}

.markdown-heading {
  margin: 0 0 0.65rem;
  line-height: 1.3;
}

.markdown-paragraph {
  margin: 0 0 0.75rem;
  white-space: normal;
}

.markdown-blockquote {
  border-inline-start: 3px solid rgba(var(--v-theme-primary), 0.55);
  margin: 0 0 0.75rem;
  padding-inline-start: 0.8rem;
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.markdown-list {
  margin: 0 0 0.75rem;
  padding-inline-start: 1.45rem;
}

.markdown-code {
  margin: 0 0 0.75rem;
  overflow-x: auto;
  border-radius: 4px;
  padding: 0.65rem 0.75rem;
  background: rgba(var(--v-theme-on-surface), 0.08);
  white-space: pre-wrap;
}

.markdown-table-wrap {
  margin: 0 0 0.75rem;
  max-width: 100%;
  overflow-x: auto;
}

.markdown-table {
  border-collapse: collapse;
  min-width: 100%;
  white-space: normal;
}

.markdown-table th,
.markdown-table td {
  border: 1px solid rgba(var(--v-theme-on-surface), 0.16);
  padding: 0.35rem 0.55rem;
  text-align: start;
  vertical-align: top;
}

.markdown-table th {
  background: rgba(var(--v-theme-on-surface), 0.07);
  font-weight: 600;
}

code {
  border-radius: 3px;
  padding: 0.05rem 0.25rem;
  background: rgba(var(--v-theme-on-surface), 0.08);
}

pre code {
  padding: 0;
  background: transparent;
}
</style>
