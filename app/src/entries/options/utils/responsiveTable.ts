export interface ResponsiveTableHeader {
  key?: string;
  value?: unknown;
  fixed?: boolean | "start" | "end";
  sortable?: boolean;
  width?: number | string;
  minWidth?: number | string;
  headerProps?: unknown;
  cellProps?: unknown;
  [key: string]: unknown;
}

export interface ResponsiveHeaderOptions {
  actionKey?: string | readonly string[];
  actionWidth?: number | string;
}

function mergeClass(existing: unknown, required: string) {
  if (!existing) return required;
  if (Array.isArray(existing)) return [...existing, required];
  return [existing, required];
}

function objectProps(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

export function normalizeResponsiveHeaders<T extends ResponsiveTableHeader>(
  headers: readonly T[],
  options: ResponsiveHeaderOptions = {},
): T[] {
  const actionKeys = new Set(
    Array.isArray(options.actionKey) ? options.actionKey : [options.actionKey ?? "action"],
  );
  const actionWidth = options.actionWidth ?? "11rem";

  return headers.map((header) => {
    const normalized = { ...header } as T;
    if (!actionKeys.has(String(header.key ?? header.value ?? ""))) return normalized;

    const headerProps = objectProps(header.headerProps);
    const cellProps = objectProps(header.cellProps);
    headerProps.class = mergeClass(headerProps.class, "ptpp-responsive-action-column");
    cellProps.class = mergeClass(cellProps.class, "ptpp-responsive-action-column");

    return {
      ...normalized,
      fixed: "end",
      sortable: false,
      width: actionWidth,
      minWidth: actionWidth,
      headerProps,
      cellProps,
    } as T;
  });
}

export function measureHorizontalOverflow(scrollWidth: number, clientWidth: number, scrollLeft = 0) {
  const normalizedClientWidth = Math.max(0, clientWidth);
  const normalizedScrollWidth = Math.max(normalizedClientWidth, scrollWidth);
  const maxScrollLeft = Math.max(0, normalizedScrollWidth - normalizedClientWidth);
  return {
    hasOverflow: normalizedScrollWidth > normalizedClientWidth + 1,
    scrollWidth: normalizedScrollWidth,
    maxScrollLeft,
    scrollLeft: Math.min(maxScrollLeft, Math.max(0, scrollLeft)),
  } as const;
}
