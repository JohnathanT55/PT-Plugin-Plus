import type { IMcpSessionOpenResponse, IMcpToolRequest, IMcpToolResult } from "../../shared/mcpBridge.ts";

interface SessionTransport<Config> {
  open(config: Config, signal: AbortSignal): Promise<IMcpSessionOpenResponse>;
  poll(config: Config, sessionId: string, signal: AbortSignal): Promise<IMcpToolRequest | null>;
  respond(config: Config, sessionId: string, result: IMcpToolResult, signal: AbortSignal): Promise<void>;
  close(config: Config, sessionId: string): Promise<void>;
  execute(request: IMcpToolRequest, signal: AbortSignal): Promise<IMcpToolResult>;
  isSessionGone(error: unknown): boolean;
  retryDelayMs?: number;
}

interface SessionGeneration<Config> {
  key: string;
  config: Config;
  controller: AbortController;
  session?: IMcpSessionOpenResponse;
  ready: Promise<IMcpSessionOpenResponse>;
  resolveReady(value: IMcpSessionOpenResponse): void;
  rejectReady(error: Error): void;
}

function newReadyPromise<Config>(generation: SessionGeneration<Config>): void {
  generation.ready = new Promise((resolve, reject) => {
    generation.resolveReady = resolve;
    generation.rejectReady = reject;
  });
  void generation.ready.catch(() => undefined);
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener("abort", finish, { once: true });
  });
}

/**
 * One owner per connection generation. Old requests retain their original
 * config/session and cannot accidentally post to a replacement connection.
 * Transport cancellation is cooperative; generation checks also discard a
 * late reply from transports/handlers that do not honor AbortSignal.
 */
export class McpSessionManager<Config> {
  private active?: SessionGeneration<Config>;

  constructor(private readonly transport: SessionTransport<Config>) {}

  configure(config: Config | undefined, key = ""): Promise<IMcpSessionOpenResponse | undefined> {
    if (config !== undefined && this.active?.key === key) {
      return this.active.session ? Promise.resolve(this.active.session) : this.active.ready;
    }
    this.stop();
    if (config === undefined) return Promise.resolve(undefined);

    let resolveReady!: SessionGeneration<Config>["resolveReady"];
    let rejectReady!: SessionGeneration<Config>["rejectReady"];
    const ready = new Promise<IMcpSessionOpenResponse>((resolve, reject) => {
      resolveReady = resolve;
      rejectReady = reject;
    });
    // Startup/retry runs in the background even if no UI currently awaits it.
    void ready.catch(() => undefined);
    const generation: SessionGeneration<Config> = {
      key,
      config,
      controller: new AbortController(),
      ready,
      resolveReady,
      rejectReady,
    };
    this.active = generation;
    void this.run(generation);
    return ready;
  }

  stop(): void {
    const previous = this.active;
    this.active = undefined;
    if (!previous) return;
    previous.controller.abort();
    previous.rejectReady(new Error("MCP bridge 会话已停止"));
    if (previous.session) void this.transport.close(previous.config, previous.session.sessionId).catch(() => undefined);
  }

  private current(generation: SessionGeneration<Config>): boolean {
    return this.active === generation && !generation.controller.signal.aborted;
  }

  private async run(generation: SessionGeneration<Config>): Promise<void> {
    const signal = generation.controller.signal;
    let failureCount = 0;
    while (this.current(generation)) {
      try {
        if (!generation.session) {
          const session = await this.transport.open(generation.config, signal);
          if (!this.current(generation)) {
            void this.transport.close(generation.config, session.sessionId).catch(() => undefined);
            break;
          }
          generation.session = session;
          generation.resolveReady(session);
        }
        const id = generation.session.sessionId;
        let request: IMcpToolRequest | null;
        try {
          request = await this.transport.poll(generation.config, id, signal);
        } catch (error) {
          // Only a missing session during polling means that we should open a
          // new one. A missing request during response can mean it timed out.
          if (this.transport.isSessionGone(error)) {
            generation.session = undefined;
            newReadyPromise(generation);
          }
          throw error;
        }
        if (!this.current(generation)) break;
        failureCount = 0;
        if (request) {
          const result = await this.transport.execute(request, signal);
          if (!this.current(generation)) break;
          await this.transport.respond(generation.config, id, result, signal);
        }
      } catch {
        if (!this.current(generation)) break;
        generation.rejectReady(new Error("MCP bridge 会话暂不可用，正在自动重连"));
        failureCount++;
        // A bounded exponential retry also survives server restarts without
        // busy-looping or opening a session for every transient fetch failure.
        const delay = Math.min(30_000, (this.transport.retryDelayMs ?? 1_000) * 2 ** Math.min(failureCount - 1, 5));
        await abortableDelay(delay, signal);
      }
    }
  }
}

export function jsonUtf8Bytes(value: unknown): number {
  try {
    const json = JSON.stringify(value);
    return json === undefined ? Number.POSITIVE_INFINITY : new TextEncoder().encode(json).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export async function executeBoundedCapability(
  request: IMcpToolRequest,
  handler: ((input: unknown) => Promise<unknown>) | undefined,
  maxResultBytes: number | undefined,
): Promise<IMcpToolResult> {
  const fail = (code: string, message: string): IMcpToolResult => ({
    requestId: request.requestId,
    ok: false,
    error: { code, message },
  });
  if (!handler || !Number.isFinite(maxResultBytes) || maxResultBytes! <= 0) {
    return fail("unsupported_capability", "PTPP 不支持此 capability");
  }
  try {
    const result = await handler(request.input);
    if (jsonUtf8Bytes(result) > maxResultBytes!) {
      return fail("result_too_large", "结果超过接口大小限制，请缩小请求范围或分批读取");
    }
    return { requestId: request.requestId, ok: true, result };
  } catch {
    // Site/downloader exceptions often contain request URLs or auth headers.
    // Business handlers may return safe structured errors, never raw throws.
    return fail("capability_failed", "请求执行失败，请查看插件中的状态或缩小请求范围后重试");
  }
}
