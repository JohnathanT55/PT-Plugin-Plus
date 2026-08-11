export interface ISearchRunGuard {
  begin(): number;
  current(): number;
  isCurrent(runId: number): boolean;
}

/**
 * Gives each full search a monotonically increasing identity. Results from an
 * older in-flight request can then be discarded after a new search, snapshot
 * load, or explicit cancellation starts.
 */
export function createSearchRunGuard(initialRunId = 0): ISearchRunGuard {
  let activeRunId = initialRunId;

  return {
    begin() {
      activeRunId += 1;
      return activeRunId;
    },
    current() {
      return activeRunId;
    },
    isCurrent(runId) {
      return runId === activeRunId;
    },
  };
}
