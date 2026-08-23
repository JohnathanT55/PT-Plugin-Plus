export const DEFAULT_SET_BASE_ROUTE_NAME = "SetBaseGeneral" as const;

export interface NavigationRouteLike {
  name?: string | symbol;
  children?: readonly NavigationRouteLike[];
  path?: string;
}

export function getNavigationTargetName(route: NavigationRouteLike): string | symbol {
  const target = route.children?.find((child) => child.path === "")?.name ?? route.name;
  if (typeof target !== "string" && typeof target !== "symbol") {
    throw new Error(`Navigation route ${route.path ?? "<unknown>"} has no named target`);
  }
  return target;
}
