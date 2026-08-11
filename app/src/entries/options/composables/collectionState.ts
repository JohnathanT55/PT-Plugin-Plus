import { readonly, ref } from "vue";

// Search-result rows each own their favorite-state lookup. Keep a lightweight
// page-local revision so a batch mutation refreshes every visible row, just as
// archived PTPP reloaded its shared collection-link list after each change.
const collectionRevision = ref(0);

export function useCollectionRevision() {
  return readonly(collectionRevision);
}

export function notifyCollectionChanged() {
  collectionRevision.value += 1;
}
