import { camelizeKeys, snakeifyKeys } from "./casing.js";
import {
  VeiledAPIError,
  VeiledConnectionError,
  type VeiledErrorCode,
} from "./failures.js";

export interface HttpClientOptions {
  apiKey: string;
  baseUrl: string;
  timeoutMs: number;
  maxRetries: number;
  fetch: typeof fetch;
  userAgent: string;
}

/** Settings you can pass as the last argument to any endpoint method to adjust that one call. */
export interface RequestConfig {
  /**
   * Cancels the call when it fires. Any retry still waiting is dropped too.
   * Get one from an `AbortController` that your code keeps a handle on.
   */
  signal?: AbortSignal;
  /** Replaces the client's `timeoutMs` for this call only. */
  timeoutMs?: number;
}

export interface RequestOptions extends RequestConfig {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  /** Payload with camelCase keys. Sent as JSON after the keys are turned into snake_case. */
  body?: unknown;
  /** URL search values with camelCase names, sent in snake_case. Undefined entries are skipped. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Additional headers merged over the defaults, such as `Idempotency-Key`. */
  headers?: Record<string, string>;
  /**
   * Allows a POST or PATCH to be retried. Only set this when the server can
   * recognise a repeat, for instance because an idempotency key is attached.
   */
  idempotent?: boolean;
}

interface ApiErrorBody {
  code?: string;
  message?: string;
  error?: string;
}

/** Responses that suggest trying again later: 408, 429 and the common 5xx codes. */
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

/**
 * Upper bound on a server-requested wait. If `Retry-After` asks for longer
 * than this, it is ignored and the usual backoff schedule applies instead,
 * so one header can't stall the caller indefinitely.
 */
const MAX_RETRY_AFTER_MS = 60_000;

export class HttpClient {
  private readonly options: HttpClientOptions;

  constructor(options: HttpClientOptions) {
    this.options = options;
  }

  async request<T>(options: RequestOptions): Promise<T> {
    // Sending a request twice must not change the outcome. Reads and deletes
    // are naturally repeatable. Writes have to opt in via `idempotent`,
    // otherwise a resend after a lost reply could duplicate a payment.
    const retryable =
      options.method === "GET" ||
      options.method === "DELETE" ||
      options.idempotent === true;
    const maxAttempts = retryable ? this.options.maxRetries + 1 : 1;

    for (let attempt = 1; ; attempt++) {
      let response: Response;
      try {
        response = await this.dispatch(options);
      } catch (cause) {
        // A cancellation by the caller ends things here, no further attempts.
        if (attempt < maxAttempts && !options.signal?.aborted) {
          await sleep(backoffMs(attempt), options.signal);
          continue;
        }
        throw cause;
      }

      if (
        !response.ok &&
        RETRYABLE_STATUSES.has(response.status) &&
        attempt < maxAttempts &&
        !options.signal?.aborted
      ) {
        // Read and discard the body to free the socket. Then pause, using the
        // server's Retry-After when it is present and within the cap.
        await response.text().catch(() => undefined);
        const retryAfter = retryAfterMs(response);
        const delayMs =
          retryAfter !== undefined && retryAfter <= MAX_RETRY_AFTER_MS
            ? retryAfter
            : backoffMs(attempt);
        await sleep(delayMs, options.signal);
        continue;
      }

      return this.handleResponse<T>(response);
    }
  }

  private async dispatch(options: RequestOptions): Promise<Response> {
    const url = this.buildUrl(options.path, options.query);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.options.apiKey}`,
      Accept: "application/json",
      "User-Agent": this.options.userAgent,
      ...options.headers,
    };

    let payload: string | undefined;
    if (options.body !== undefined) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(snakeifyKeys(options.body));
    }

    const timeoutMs = options.timeoutMs ?? this.options.timeoutMs;
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    // Forward a caller cancellation into our own controller, so the timer and
    // the caller can each stop the fetch. Done by hand because
    // AbortSignal.any only exists from Node 20.
    const abortFromCaller = () => controller.abort();
    if (options.signal?.aborted) {
      controller.abort();
    } else {
      options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    }

    let response: Response;
    try {
      response = await this.options.fetch(url, {
        method: options.method,
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") {
        throw new VeiledConnectionError(
          timedOut
            ? `No response from ${options.path} within ${timeoutMs}ms`
            : `Call to ${options.path} was cancelled before it completed`,
          cause,
        );
      }
      throw new VeiledConnectionError(
        `Could not reach ${options.path}: ${(cause as Error)?.message ?? "no details available"}`,
        cause,
      );
    } finally {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }

    return response;
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const raw = await response.text();

    let parsed: unknown = undefined;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = raw;
      }
    }

    if (!response.ok) {
      const errBody = (parsed ?? {}) as ApiErrorBody;
      throw new VeiledAPIError({
        status: response.status,
        code: (errBody.code as VeiledErrorCode) ?? "unknown_error",
        message:
          errBody.message ??
          errBody.error ??
          `Veiled API returned HTTP ${response.status}` +
            (requestId ? ` [request id ${requestId}]` : ""),
        body: parsed,
        requestId,
      });
    }

    return camelizeKeys<T>(parsed);
  }

  private buildUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): string {
    const url = new URL(path.replace(/^\//, ""), ensureTrailingSlash(this.options.baseUrl));
    if (query) {
      const snake = snakeifyKeys<Record<string, unknown>>(query);
      for (const [key, value] of Object.entries(snake)) {
        if (value !== undefined && value !== null) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }
}

function ensureTrailingSlash(base: string): string {
  return base.endsWith("/") ? base : `${base}/`;
}

/**
 * Pauses for `ms` milliseconds before the next attempt. If the caller cancels
 * during the pause it returns straight away, and the following attempt fails
 * fast with the cancellation instead of waiting out the full delay.
 */
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

/** Delay before retry number `attempt`: doubles from 500ms up to 8s, randomised by plus or minus 25%. */
function backoffMs(attempt: number): number {
  const base = Math.min(500 * 2 ** (attempt - 1), 8_000);
  return base * (0.75 + Math.random() * 0.5);
}

/** Reads `Retry-After` as either a number of seconds or an HTTP date and converts it to milliseconds. */
function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;

  const seconds = Number(header);
  if (Number.isFinite(seconds)) {
    return Math.max(0, seconds * 1_000);
  }

  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }

  return undefined;
}
