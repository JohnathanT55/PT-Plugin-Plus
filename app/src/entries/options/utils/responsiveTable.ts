export type ResponsiveColumnRole = "primary" | "secondary" | "action";

export interface ResponsiveTableHeader {
  key?: string;
  value?: unknown;
  fixed?: boolean | "start" | "end";
  sortable?: boolean;
  width?: number | string;
  minWidth?: number | string;
  headerProps?: unknown;
  cellProps?: unknown;
  ptppRole?: ResponsiveColumnRole;
  [key: string]: unknown;
}

export interface ResponsiveHeaderOptions {
  primaryKeys?: readonly string[];
  actionKey?: string | readonly string[];
  actionWidth?: number | string;
  secondaryMinWidth?: number | string;
}

function mergeClass(existing: unknown, required: string) {
  if (!existing) return required;
  if (Array.isArray(existing)) return [...existing, required];
  return [existing, required];
}

function objectProps(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? { ...(value as Record<string, unknown>) } : {};
}

function withRoleClasses<T extends ResponsiveTableHeader>(header: T, role: ResponsiveColumnRole) {
  const headerProps = objectProps(header.headerProps);
  const cellProps = objectProps(header.cellProps);
  const className = `ptpp-responsive-${role}-column`;
  headerProps.class = mergeClass(headerProps.class, className);
  cellProps.class = mergeClass(cellProps.class, className);
  return { headerProps, cellProps };
}

export function normalizeResponsiveHeaders<T extends ResponsiveTableHeader>(
  headers: readonly T[],
  options: ResponsiveHeaderOptions = {},
): Array<T & { ptppRole: ResponsiveColumnRole }> {
  const primaryKeys = new Set(options.primaryKeys ?? []);
  const actionKeys = new Set(Array.isArray(options.actionKey) ? options.actionKey : [options.actionKey ?? "action"]);
  const actionWidth = options.actionWidth ?? "11rem";
  const secondaryMinWidth = options.secondaryMinWidth ?? "7rem";

  return headers.map((header) => {
    const key = String(header.key ?? header.value ?? "");
    const role: ResponsiveColumnRole = actionKeys.has(key) ? "action" : primaryKeys.has(key) ? "primary" : "secondary";
    const normalized = {
      ...header,
      ...withRoleClasses(header, role),
      ptppRole: role,
    } as T & { ptppRole: ResponsiveColumnRole };

    if (role === "action") {
      return {
        ...normalized,
        fixed: "end",
        sortable: false,
        width: actionWidth,
        minWidth: actionWidth,
      };
    }

    // Primary and secondary content must scroll beneath the isolated action
    // region. Remove inherited sticky metadata rather than mutating the input.
    delete normalized.fixed;
    if (role === "secondary" && header.width === undefined && header.minWidth === undefined) {
      normalized.minWidth = secondaryMinWidth;
    }
    return normalized;
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
