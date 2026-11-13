import { VeiledError } from "../failures.js";
import type { HttpClient, RequestConfig } from "../transport.js";
import type {
  CreateTransferParams,
  ListTransfersParams,
  Transfer,
  TransferList,
} from "../models.js";

export interface WaitForConfirmationOptions extends RequestConfig {
  /** Milliseconds to pause between status checks. The default is `1000`. */
  pollIntervalMs?: number;
  /**
   * Total time budget for the wait, in milliseconds, after which an error is
   * thrown. The default is `60000`. This is separate from `timeoutMs`, which
   * limits each status request on its own.
   */
  maxWaitMs?: number;
}

export interface CreateTransferOptions extends RequestConfig {
  /**
   * Sent as the `Idempotency-Key` header. Requests that share a key produce
   * no more than one transfer, which makes retries safe. If you leave it out,
   * the SDK makes a random one for each `create` call. Pass a value you can
   * recreate, such as an order number, when retries might happen after your
   * process restarts.
   */
  idempotencyKey?: string;
}

/**
 * Endpoints for sending transfers and looking them up. Transfers are
 * confidential unless you opt out, and the API never echoes the amount back
 * in plaintext, not even in the response to the call that set it.
 */
export class Transfers {
  constructor(private readonly http: HttpClient) {}

  /**
   * Send a transfer. Each call includes an idempotency key, so the SDK can
   * retry it after a network error without risk of paying twice.
   *
   * @param params Recipient, amount and optional asset, confidentiality and memo.
   * @param options Per-request settings, including an optional `idempotencyKey`.
   * @returns The transfer as recorded by the API, usually still `pending`.
   * @example
   * ```ts
   * const transfer = await veiled.transfers.create(
   *   { to: "@northwind", amount: "42.50", memo: "March hosting" },
   *   { idempotencyKey: "order-58213" },
   * );
   * ```
   */
  async create(
    params: CreateTransferParams,
    options: CreateTransferOptions = {},
  ): Promise<Transfer> {
    const { idempotencyKey, ...config } = options;
    return this.http.request<Transfer>({
      method: "POST",
      path: "/v1/transfers",
      body: params,
      headers: {
        "Idempotency-Key": idempotencyKey ?? generateIdempotencyKey(),
      },
      idempotent: true,
      ...config,
    });
  }

  /**
   * Look up one transfer.
   *
   * @param transferId The transfer's ID.
   * @example
   * ```ts
   * const transfer = await veiled.transfers.get("tr_9fA21c");
   * console.log(transfer.status);
   * ```
   */
  async get(transferId: string, config: RequestConfig = {}): Promise<Transfer> {
    return this.http.request<Transfer>({
      method: "GET",
      path: `/v1/transfers/${encodeURIComponent(transferId)}`,
      ...config,
    });
  }

  /**
   * Fetch a single page of transfers, newest first. Use `iterate` if you want
   * to walk through all pages.
   *
   * @param params Paging (`limit`, `offset`) and filters (`status`, `from`, `to`).
   * @example
   * ```ts
   * const { transfers } = await veiled.transfers.list({ limit: 25, status: "failed" });
   * ```
   */
  async list(
    params: ListTransfersParams = {},
    config: RequestConfig = {},
  ): Promise<TransferList> {
    return this.http.request<TransferList>({
      method: "GET",
      path: "/v1/transfers",
      query: {
        limit: params.limit,
        offset: params.offset,
        status: params.status,
        from: params.from,
        to: params.to,
      },
      ...config,
    });
  }

  /**
   * Walk through all transfers that match the filters, newest first. Pages
   * are fetched lazily as the loop needs them (100 per page unless you set
   * `limit`), and leaving the loop early stops any further requests.
   *
   * @param params The same filters as `list`, minus `offset`.
   * @example
   * ```ts
   * for await (const transfer of veiled.transfers.iterate({ to: "2026-06-30T00:00:00Z" })) {
   *   if (transfer.status === "failed") console.warn(transfer.transferId);
   * }
   * ```
   */
  async *iterate(
    params: Omit<ListTransfersParams, "offset"> = {},
    config: RequestConfig = {},
  ): AsyncGenerator<Transfer, void, undefined> {
    const limit = params.limit ?? 100;
    let offset = 0;
    for (;;) {
      const { transfers } = await this.list({ ...params, limit, offset }, config);
      yield* transfers;
      if (transfers.length < limit) return;
      offset += transfers.length;
    }
  }

  /**
   * Keep checking a transfer until it is no longer `pending`, then return it.
   * Most transfers settle in well under a second, so with the default interval
   * one or two checks are typical.
   *
   * The promise resolves for both `confirmed` and `failed`, so read `status`
   * on the result to tell them apart.
   *
   * @param transferId The transfer's ID.
   * @param options Polling interval, overall wait limit, and per-request settings.
   * @throws {VeiledError} If the transfer is still pending when the next check
   * would fall past `maxWaitMs`, or if `signal` is aborted during the wait.
   * @example
   * ```ts
   * const sent = await veiled.transfers.create({ to: "@northwind", amount: "42.50" });
   * const settled = await veiled.transfers.waitForConfirmation(sent.transferId, {
   *   pollIntervalMs: 500,
   *   maxWaitMs: 20_000,
   * });
   * if (settled.status === "failed") throw new Error("payment did not go through");
   * ```
   */
  async waitForConfirmation(
    transferId: string,
    options: WaitForConfirmationOptions = {},
  ): Promise<Transfer> {
    const { pollIntervalMs = 1_000, maxWaitMs = 60_000, ...config } = options;
    const deadline = Date.now() + maxWaitMs;

    for (;;) {
      const transfer = await this.get(transferId, config);
      if (transfer.status !== "pending") return transfer;
      if (Date.now() + pollIntervalMs > deadline) {
        throw new VeiledError(
          `Gave up on transfer ${transferId} after ${maxWaitMs}ms because it had not settled. ` +
            "It can still settle later, so look it up again with `transfers.get`.",
        );
      }
      await sleep(pollIntervalMs, config.signal);
      if (config.signal?.aborted) {
        throw new VeiledError(
          `Stopped waiting on transfer ${transferId} because the signal was aborted.`,
        );
      }
    }
  }
}

/** Resolve after `ms` milliseconds, or as soon as `signal` aborts. Never rejects. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(done, ms);
    function done() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

function generateIdempotencyKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) return uuid;
  // No Web Crypto available, so build a key from the clock and Math.random.
  // If two keys ever collided, the worst outcome is that a real transfer gets
  // treated as a repeat and skipped; money is never sent twice.
  return `vl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}
