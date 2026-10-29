import type { ISiteMetadata, ISearchEntryRequestConfig } from "@ptd/site";
import type { IMetadataPiniaStorageSchema, ISearchSolutionMetadata } from "./types.ts";

type SearchMetadata = Pick<IMetadataPiniaStorageSchema, "sites" | "solutions" | "defaultSolutionId">;
type SiteMetadataReader = (siteId: string) => Promise<ISiteMetadata>;

/** Resolve the UI's existing search plans without a Pinia or DOM dependency. */
export async function resolveSearchSolution(
  metadata: SearchMetadata,
  readSite: SiteMetadataReader,
  requestedId: string,
): Promise<ISearchSolutionMetadata | undefined> {
  const id = requestedId === "default" ? metadata.defaultSolutionId || "default" : requestedId;
  const defaultEntries = async (siteId: string): Promise<Record<string, ISearchEntryRequestConfig> | undefined> => {
    const user = metadata.sites[siteId];
    if (!user || user.isOffline || user.allowSearch === false) return undefined;
    const definition = await readSite(siteId);
    if (definition.isDead) return undefined;
    // Site instances resolve the static definition by id. Never pass functions
    // from a definition through browser messaging, or mutate that definition.
    return Object.fromEntries(Object.entries(definition.searchEntry ?? { default: {} }).map(([key, entry]) => [key, {
      id: key,
      ...(entry.name ? { name: entry.name } : {}),
      enabled: user.merge?.searchEntry?.[key]?.enabled ?? entry.enabled,
    }]));
  };
  if (id === "all" || id === "default" || id.startsWith("site:")) {
    const sites = id.startsWith("site:") ? [...new Set(id.slice(5).split(",").map((value) => value.trim()).filter(Boolean))] : Object.keys(metadata.sites);
    const solutions: ISearchSolutionMetadata["solutions"] = [];
    for (const siteId of sites) {
      const searchEntries = await defaultEntries(siteId);
      if (searchEntries) solutions.push({ id: "default", siteId, searchEntries });
    }
    return { id: id.startsWith("site:") ? id : "all", name: "all", enabled: true, isDefault: true, sort: 0, createdAt: 0, solutions };
  }
  const saved = metadata.solutions[id];
  if (!saved) return undefined;
  const solutions: ISearchSolutionMetadata["solutions"] = [];
  for (const item of saved.solutions) {
    const user = metadata.sites[item.siteId];
    if (!user || user.isOffline || user.allowSearch === false) continue;
    if (item.id === "default") {
      const searchEntries = await defaultEntries(item.siteId);
      if (searchEntries) solutions.push({ ...item, searchEntries });
    } else {
      if ((await readSite(item.siteId)).isDead) continue;
      solutions.push({ ...item, searchEntries: structuredClone(item.searchEntries) });
    }
  }
  return { ...saved, solutions };
}
