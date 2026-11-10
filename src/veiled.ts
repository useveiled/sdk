import { HttpClient } from "./transport.js";
import { VeiledError } from "./failures.js";
import { Accounts } from "./endpoints/accounts.js";
import { Agents } from "./endpoints/agents.js";
import { Transfers } from "./endpoints/transfers.js";
import { Webhooks } from "./endpoints/webhooks.js";

const DEFAULT_BASE_URL = "https://api.useveiled.com";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;
const SDK_VERSION = "0.1.1";

/** The network a key belongs to. The client works this out from the key prefix. */
export type Environment = "live" | "test";

export interface VeiledOptions {
  /**
   * The secret key used to authenticate every call. A key starting with
   * `vl_test_` talks to Solana devnet; any other key (normally `vl_live_`)
   * is treated as mainnet. Load it from configuration or an environment
   * variable instead of committing it to source.
   */
  apiKey: string;
  /** Root URL that request paths are resolved against. Falls back to `https://api.useveiled.com`. */
  baseUrl?: string;
  /** Milliseconds a single HTTP attempt may run before it is cancelled. Falls back to `30000`. */
  timeoutMs?: number;
  /**
   * Extra attempts allowed after the first one fails for a temporary reason:
   * the connection dropped, or the server answered `408`, `429`, `500`,
   * `502`, `503` or `504`. Waits grow exponentially, and a reasonable
   * `Retry-After` from the server takes priority. GET and DELETE calls
   * qualify, as do writes sent with an idempotency key. Falls back to `2`.
   * Pass `0` to send each request exactly once.
   */
  maxRetries?: number;
  /**
   * The function used to make HTTP calls. When left out, the client uses
   * `globalThis.fetch`, which Node 18 and later, browsers and edge runtimes
   * ship with. Supply your own for testing, proxies or older runtimes.
   */
  fetch?: typeof fetch;
}

/**
 * Entry point to the SDK. One instance holds your key and settings and
 * exposes a namespace per area of the API.
 *
 * @throws {VeiledError} If `apiKey` is empty or no `fetch` function can be found.
 *
 * @example
 * ```ts
 * import { Veiled } from "@useveiled/sdk";
 *
 * const veiled = new Veiled({ apiKey: process.env.VEILED_KEY!, maxRetries: 3 });
 * const payment = await veiled.transfers.create({ to: "@acme-hosting", amount: "48.90" });
 * console.log(payment.status);
 * ```
 */
export class Veiled {
  /** Look up the signed-in account and its balances. */
  readonly accounts: Accounts;
  /** Send funds and look up past transfers. */
  readonly transfers: Transfers;
  /** Create agent accounts and control what they are allowed to spend. */
  readonly agents: Agents;
  /** Register endpoints for event notifications and check incoming deliveries. */
  readonly webhooks: Webhooks;

  /** `"test"` for a `vl_test_` key, otherwise `"live"`. */
  readonly environment: Environment;

  constructor(options: VeiledOptions) {
    if (!options?.apiKey) {
      throw new VeiledError(
        "Missing API key. Create the client with `new Veiled({ apiKey })`.",
      );
    }

    this.environment = options.apiKey.startsWith("vl_test_") ? "test" : "live";

    const fetchImpl = options.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new VeiledError(
        "This runtime has no global `fetch`. Use Node 18 or newer, or supply one through the `fetch` option.",
      );
    }

    const http = new HttpClient({
      apiKey: options.apiKey,
      baseUrl: options.baseUrl ?? DEFAULT_BASE_URL,
      timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxRetries: Math.max(0, options.maxRetries ?? DEFAULT_MAX_RETRIES),
      fetch: fetchImpl,
      userAgent: `veiled-sdk/${SDK_VERSION}`,
    });

    this.accounts = new Accounts(http);
    this.transfers = new Transfers(http);
    this.agents = new Agents(http);
    this.webhooks = new Webhooks(http);
  }
}
