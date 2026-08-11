import { collectionItemKey } from "@foundation/collection/model";

import { sendMessage } from "@/messages.ts";

let cachedRevision = -1;
let cachedLinksPromise: Promise<ReadonlySet<string>> | undefined;

/**
 * Every visible result row needs the same collection state. Sharing one
 * request per revision avoids dozens of service-worker/storage round trips
 * whenever Chrome restores or repaints a large search-result page.
 */
export function getCollectionLinks(revision: number): Promise<ReadonlySet<string>> {
  if (revision !== cachedRevision || !cachedLinksPromise) {
    cachedRevision = revision;
    const request = sendMessage("getPtppCollectionState", undefined).then(
      (state) => new Set(state.items.map((item) => collectionItemKey(item))),
    );
    const cachedRequest = request.catch((error) => {
      if (cachedLinksPromise === cachedRequest) cachedLinksPromise = undefined;
      throw error;
    });
    cachedLinksPromise = cachedRequest;
  }
  return cachedLinksPromise;
}
