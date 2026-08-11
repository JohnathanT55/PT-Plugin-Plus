import {
  notifyCollectionChanged,
  useCollectionRevision,
} from "../../app/src/entries/options/composables/collectionState.ts";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`PTPP collection-state test failed: ${message}`);
}

const firstSubscriber = useCollectionRevision();
const secondSubscriber = useCollectionRevision();
const initialRevision = firstSubscriber.value;

notifyCollectionChanged();

assert(firstSubscriber.value === initialRevision + 1, "a favorite mutation advances the shared revision");
assert(secondSubscriber.value === firstSubscriber.value, "every search-result row observes the same revision");

console.log("PTPP collection-state synchronization tests passed");
