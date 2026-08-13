import type { TSiteID } from "@ptd/site";

export interface IMyDataSiteActionItem {
  site: TSiteID;
  selectable?: boolean;
  refreshable?: boolean;
}

function uniqueSiteIds(siteIds: TSiteID[]): TSiteID[] {
  return [...new Set(siteIds)];
}

export function resolveOpenSiteIds(selectedSiteIds: TSiteID[], items: IMyDataSiteActionItem[]): TSiteID[] {
  const availableIds = items.filter((item) => item.selectable !== false).map((item) => item.site);
  const requestedIds = selectedSiteIds.length > 0 ? selectedSiteIds : availableIds;
  const available = new Set(availableIds);
  return uniqueSiteIds(requestedIds).filter((siteId) => available.has(siteId));
}

export function resolveRefreshSiteIds(selectedSiteIds: TSiteID[], items: IMyDataSiteActionItem[]): TSiteID[] {
  const requestedIds = resolveOpenSiteIds(selectedSiteIds, items);
  const refreshable = new Set(items.filter((item) => item.refreshable === true).map((item) => item.site));
  return requestedIds.filter((siteId) => refreshable.has(siteId));
}
