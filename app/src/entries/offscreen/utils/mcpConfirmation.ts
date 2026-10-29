/**
 * Short-lived, one-time approvals for MCP actions.
 *
 * The bridge deliberately does not treat a missing token as consent.  An
 * action handler can create a pending record containing the exact input and
 * the human-readable diff that the PTPP UI will display.  Once the user
 * approves it, consume() verifies the capability and exact canonical input before
 * deleting the record.  This keeps a token bound to one operation and makes a
 * late/replayed request harmless.
 */

export interface IMcpPendingConfirmation {
  confirmationId: string;
  capability: string;
  summary: string;
  diff: unknown;
  createdAt: number;
  expiresAt: number;
  status: "pending" | "approved";
}

export interface IMcpConfirmationRequest {
  code: "confirmation_required";
  message: string;
  confirmationId: string;
  summary: string;
  diff: unknown;
  expiresAt: number;
}

type ConfirmationOptions = {
  now?: () => number;
  ttlMs?: number;
  maxPending?: number;
  createToken?: () => string;
};

interface StoredConfirmation extends IMcpPendingConfirmation {
  scope: string;
  canonicalInput: string;
  approvalToken?: string;
}

function stable(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Approval input must be JSON data");
  return `{${Object.keys(value as Record<string, unknown>)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}

/** Canonical input equality avoids weak-hash collisions between different edits. */
export function confirmationFingerprint(value: unknown): string {
  return stable(value);
}

function defaultToken(): string {
  return crypto.randomUUID();
}

export class McpConfirmationStore {
  private readonly pending = new Map<string, StoredConfirmation>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxPending: number;
  private readonly createToken: () => string;

  constructor(options: ConfirmationOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = Math.min(10 * 60_000, Math.max(10_000, Math.round(options.ttlMs ?? 120_000)));
    this.maxPending = Math.min(100, Math.max(1, Math.floor(options.maxPending ?? 20)));
    this.createToken = options.createToken ?? defaultToken;
  }

  private prune(): void {
    const timestamp = this.now();
    for (const [token, item] of this.pending) if (item.expiresAt <= timestamp) this.pending.delete(token);
  }

  create(capability: string, input: unknown, summary: string, diff: unknown, scope = ""): IMcpConfirmationRequest {
    this.prune();
    const confirmationId = this.createToken();
    const createdAt = this.now();
    const item: StoredConfirmation = {
      confirmationId,
      capability,
      canonicalInput: confirmationFingerprint(input),
      scope,
      status: "pending",
      summary: summary.slice(0, 500),
      diff: structuredClone(diff),
      createdAt,
      expiresAt: createdAt + this.ttlMs,
    };
    this.pending.set(confirmationId, item);
    while (this.pending.size > this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (!oldest) break;
      this.pending.delete(oldest);
    }
    return {
      code: "confirmation_required",
      message: "请在 PTPP AI 浮窗中确认这项修改后再继续。",
      confirmationId,
      summary: item.summary,
      diff: structuredClone(diff),
      expiresAt: item.expiresAt,
    };
  }

  /** Only a trusted PTPP UI confirmation handler may call this method. */
  approve(confirmationId: string, scope = ""): string | undefined {
    this.prune();
    const item = this.pending.get(confirmationId);
    if (!item || item.status !== "pending" || item.scope !== scope) return undefined;
    item.status = "approved";
    item.approvalToken = this.createToken();
    return item.approvalToken;
  }

  /** Consume an approval exactly once, only for the original action input. */
  consume(token: string, capability: string, input: unknown, scope = ""): IMcpPendingConfirmation | undefined {
    this.prune();
    const item = [...this.pending.values()].find((candidate) => candidate.approvalToken === token && candidate.status === "approved");
    if (!item || item.scope !== scope || item.capability !== capability || item.canonicalInput !== confirmationFingerprint(input)) return undefined;
    this.pending.delete(item.confirmationId);
    return this.publicItem(item);
  }

  revoke(confirmationId: string): boolean {
    return this.pending.delete(confirmationId);
  }

  clear(): void {
    this.pending.clear();
  }

  private publicItem(item: StoredConfirmation): IMcpPendingConfirmation {
    const { confirmationId, capability, summary, diff, createdAt, expiresAt, status } = item;
    return { confirmationId, capability, summary, diff: structuredClone(diff), createdAt, expiresAt, status };
  }

  list(scope = ""): IMcpPendingConfirmation[] {
    this.prune();
    return [...this.pending.values()].filter((item) => item.scope === scope).map((item) => this.publicItem(item));
  }
}
