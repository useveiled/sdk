/**
 * Stable identifiers the API puts in the `code` field of an error response.
 * The listed values are the known ones; any other string is still accepted
 * so that codes added later on the server don't break your build.
 */
export type VeiledErrorCode =
  | "unauthorized"
  | "kyc_required"
  | "decryption_proof_invalid"
  | "invalid_request"
  | "insufficient_balance"
  | "recipient_not_found"
  | "recipient_not_confidential_ready"
  | "invalid_policy"
  | "not_agent_owner"
  | "transaction_not_found"
  | "transaction_expired"
  | (string & {});

/**
 * Parent of all errors the SDK raises. Use `instanceof VeiledError` when you
 * want a single check that covers API, network and verification problems.
 */
export class VeiledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VeiledError";
  }
}

/**
 * Raised when the server answers with a status outside the 200 range.
 * Inspect `code` to branch on the reason and `status` for the HTTP result.
 *
 * @example
 * ```ts
 * try {
 *   await veiled.transfers.create({ to: "@lena-studio", amount: "9000.00" });
 * } catch (err) {
 *   if (err instanceof VeiledAPIError && err.code === "insufficient_balance") {
 *     console.warn(`Top up first (request ${err.requestId})`);
 *   }
 * }
 * ```
 */
export class VeiledAPIError extends VeiledError {
  /** The HTTP status of the response, such as `404`. */
  readonly status: number;
  /** Reason from the response body, such as `recipient_not_found`. Falls back to `unknown_error`. */
  readonly code: VeiledErrorCode;
  /** Response body as JSON if it parsed, the plain text if not, or `undefined` if empty. */
  readonly body: unknown;
  /** Value of the `x-request-id` response header. Quote it when you ask support about a failure. */
  readonly requestId: string | undefined;

  constructor(params: {
    status: number;
    code: VeiledErrorCode;
    message: string;
    body: unknown;
    requestId?: string;
  }) {
    super(params.message);
    this.name = "VeiledAPIError";
    this.status = params.status;
    this.code = params.code;
    this.body = params.body;
    this.requestId = params.requestId;
  }
}

/**
 * Raised by `webhooks.constructEvent` when an incoming delivery can't be
 * trusted, either because its signature is wrong or because its body isn't
 * JSON. Respond with an error status and ignore the contents.
 */
export class VeiledWebhookVerificationError extends VeiledError {
  constructor(message: string) {
    super(message);
    this.name = "VeiledWebhookVerificationError";
  }
}

/**
 * Raised when no HTTP response was received at all: the network failed, the
 * timeout expired or the caller cancelled. The original error is on `cause`.
 */
export class VeiledConnectionError extends VeiledError {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "VeiledConnectionError";
    this.cause = cause;
  }
}
