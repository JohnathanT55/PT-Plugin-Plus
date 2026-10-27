export type TMarkdownInlineNode =
  | { type: "text"; value: string }
  | { type: "break" }
  | { type: "code"; value: string }
  | { type: "strong" | "emphasis"; children: TMarkdownInlineNode[] }
  | { type: "link"; label: TMarkdownInlineNode[]; href: string };

export type TMarkdownBlockNode =
  | { type: "paragraph" | "heading" | "blockquote"; children: TMarkdownInlineNode[]; level?: number }
  | { type: "unordered-list" | "ordered-list"; items: TMarkdownInlineNode[][] }
  | { type: "table"; headers: TMarkdownInlineNode[][]; rows: TMarkdownInlineNode[][][] }
  | { type: "code"; value: string }
  | { type: "hr" };

const inlineSpecialCharacters = new Set(["*", "_", "`", "[", "\\", "\n"]);

function findClosingMarker(source: string, marker: string, start: number): number {
  let index = start;
  while ((index = source.indexOf(marker, index)) !== -1) {
    if (index === 0 || source[index - 1] !== "\\") return index;
    index += marker.length;
  }
  return -1;
}

function pushText(nodes: TMarkdownInlineNode[], value: string) {
  if (!value) return;
  const previous = nodes[nodes.length - 1];
  if (previous?.type === "text") previous.value += value;
  else nodes.push({ type: "text", value });
}

/**
 * Parse the small, intentionally safe Markdown subset used by AI responses.
 * Text is kept as Vue text nodes by the renderer; raw HTML is never emitted.
 */
export function parseMarkdownInline(source: string): TMarkdownInlineNode[] {
  const nodes: TMarkdownInlineNode[] = [];
  let plainText = "";
  const flushText = () => {
    pushText(nodes, plainText.replaceAll(/\\([*_`[\\]])/g, "$1"));
    plainText = "";
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "\\" && index + 1 < source.length && "*_`[]\\".includes(source[index + 1])) {
      plainText += source[index + 1];
      index += 1;
      continue;
    }
    if (!inlineSpecialCharacters.has(character)) {
      plainText += character;
      continue;
    }
    if (character === "\n") {
      flushText();
      nodes.push({ type: "break" });
      continue;
    }

    const marker = source.slice(index, index + 2);
    if (marker === "**" || marker === "__") {
      const close = findClosingMarker(source, marker, index + 2);
      if (close > index + 2) {
        flushText();
        nodes.push({ type: "strong", children: parseMarkdownInline(source.slice(index + 2, close)) });
        index = close + 1;
        continue;
      }
    }
    if (character === "*" || character === "_") {
      const close = findClosingMarker(source, character, index + 1);
      if (close > index + 1) {
        flushText();
        nodes.push({ type: "emphasis", children: parseMarkdownInline(source.slice(index + 1, close)) });
        index = close;
        continue;
      }
    }
    if (character === "`") {
      const close = findClosingMarker(source, "`", index + 1);
      if (close > index + 1) {
        flushText();
        nodes.push({ type: "code", value: source.slice(index + 1, close) });
        index = close;
        continue;
      }
    }
    if (character === "[") {
      const labelEnd = source.indexOf("](", index + 1);
      const hrefEnd = labelEnd === -1 ? -1 : source.indexOf(")", labelEnd + 2);
      if (labelEnd > index + 1 && hrefEnd > labelEnd + 2) {
        const href = source.slice(labelEnd + 2, hrefEnd).trim();
        if (/^(?:https?:|mailto:)/i.test(href)) {
          flushText();
          nodes.push({
            type: "link",
            label: parseMarkdownInline(source.slice(index + 1, labelEnd)),
            href,
          });
          index = hrefEnd;
          continue;
        }
      }
    }
    plainText += character;
  }
  flushText();
  return nodes;
}

function isBlockStart(line: string): boolean {
  return (
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^\s*[-*+]\s+/.test(line) ||
    /^\s*\d+[.)]\s+/.test(line) ||
    /^\s*>/.test(line) ||
    /^\s*```/.test(line) ||
    /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line)
  );
}

function isHorizontalRule(line: string): boolean {
  return /^\s*((\*\s*){3,}|(-\s*){3,}|(_\s*){3,})$/.test(line);
}

function normalizeTableLine(line: string): string {
  let normalized = line.trim();
  // Some compatible models emit a backslash as a visual line-break marker,
  // or escape the leading/trailing pipe. Accept both forms for display.
  if (normalized.startsWith("\\|")) normalized = normalized.slice(1);
  if (normalized.endsWith("\\")) normalized = normalized.slice(0, -1).trimEnd();
  return normalized;
}

function parseTableCells(line: string): string[] {
  const normalized = normalizeTableLine(line);
  const withoutOuterPipes = normalized.replace(/^\|/, "").replace(/\|$/, "");
  const cells: string[] = [];
  let value = "";
  let escaped = false;
  for (const character of withoutOuterPipes) {
    if (escaped) {
      value += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === "|") {
      cells.push(value.trim());
      value = "";
    } else {
      value += character;
    }
  }
  if (escaped) value += "\\";
  cells.push(value.trim());
  return cells;
}

function isTableSeparator(line: string): boolean {
  const cells = parseTableCells(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function parseList(lines: string[], start: number, ordered: boolean): { node: TMarkdownBlockNode; next: number } {
  const items: TMarkdownInlineNode[][] = [];
  let index = start;
  const pattern = ordered ? /^\s*\d+[.)]\s+(.+)$/ : /^\s*[-*+]\s+(.+)$/;
  while (index < lines.length) {
    const match = lines[index].match(pattern);
    if (!match) break;
    items.push(parseMarkdownInline(match[1]));
    index += 1;
  }
  return { node: { type: ordered ? "ordered-list" : "unordered-list", items }, next: index };
}

export function parseMarkdown(source: string): TMarkdownBlockNode[] {
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const blocks: TMarkdownBlockNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }
    if (/^\s*```/.test(line)) {
      index += 1;
      const code: string[] = [];
      while (index < lines.length && !/^\s*```/.test(lines[index])) code.push(lines[index++]);
      if (index < lines.length) index += 1;
      blocks.push({ type: "code", value: code.join("\n") });
      continue;
    }
    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      blocks.push({ type: "heading", level: heading[1].length, children: parseMarkdownInline(heading[2]) });
      index += 1;
      continue;
    }
    if (isHorizontalRule(line)) {
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = parseTableCells(line).map((cell) => parseMarkdownInline(cell));
      index += 2;
      const rows: TMarkdownInlineNode[][][] = [];
      while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
        rows.push(parseTableCells(lines[index]).map((cell) => parseMarkdownInline(cell)));
        index += 1;
      }
      blocks.push({ type: "table", headers, rows });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      const parsed = parseList(lines, index, false);
      blocks.push(parsed.node);
      index = parsed.next;
      continue;
    }
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const parsed = parseList(lines, index, true);
      blocks.push(parsed.node);
      index = parsed.next;
      continue;
    }
    if (/^\s*>/.test(line)) {
      const quote: string[] = [];
      while (index < lines.length && /^\s*>/.test(lines[index])) {
        quote.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push({ type: "blockquote", children: parseMarkdownInline(quote.join("\n")) });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !isBlockStart(lines[index])) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", children: parseMarkdownInline(paragraph.join("\n")) });
  }
  return blocks;
}
