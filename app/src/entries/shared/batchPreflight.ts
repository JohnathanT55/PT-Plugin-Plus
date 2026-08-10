export interface BatchPreflightFailure {
  index: number;
  error: unknown;
}

export type BatchPreflightResult<T> =
  | { ok: true; prepared: T[]; failures: [] }
  | { ok: false; prepared: []; failures: BatchPreflightFailure[] };

export interface PreflightedBatchResult<TPrepared, TResult> {
  preflight: BatchPreflightResult<TPrepared>;
  results: TResult[];
}

/**
 * Prepare every item before allowing the first side effect. This cannot make
 * remote downloader requests transactional, but it guarantees that local
 * validation/template failures never leave a batch half-sent.
 */
export async function preflightBatch<TInput, TPrepared>(
  inputs: readonly TInput[],
  prepare: (input: TInput, index: number) => Promise<TPrepared> | TPrepared,
): Promise<BatchPreflightResult<TPrepared>> {
  const settled = await Promise.allSettled(inputs.map((input, index) => prepare(input, index)));
  const failures = settled.flatMap((result, index) =>
    result.status === "rejected" ? [{ index, error: result.reason }] : [],
  );
  if (failures.length > 0) return { ok: false, prepared: [], failures };

  return {
    ok: true,
    prepared: settled.map((result) => (result as PromiseFulfilledResult<TPrepared>).value),
    failures: [],
  };
}

export async function executePreflightedBatch<TInput, TPrepared, TResult>(
  inputs: readonly TInput[],
  prepare: (input: TInput, index: number) => Promise<TPrepared> | TPrepared,
  execute: (prepared: TPrepared, index: number) => Promise<TResult> | TResult,
): Promise<PreflightedBatchResult<TPrepared, TResult>> {
  const preflight = await preflightBatch(inputs, prepare);
  if (!preflight.ok) return { preflight, results: [] };

  return {
    preflight,
    results: await Promise.all(preflight.prepared.map((prepared, index) => execute(prepared, index))),
  };
}
