/**
 * Shapes of the objects the SDK accepts and returns. Everything here uses
 * camelCase property names. The HTTP layer handles renaming to and from the
 * snake_case keys the server actually sends, so you never see those.
 */

export type Asset = "USDG" | "USDC" | "SOL" | (string & {});

export type AccountType = "personal" | "business" | "agent";

export type KycStatus = "unverified" | "pending" | "verified" | "enhanced";

export type TransferStatus = "pending" | "confirmed" | "failed";

export type AgentStatus = "active" | "paused" | "disabled" | (string & {});

/** Profile of the account that owns the API key. */
export interface Account {
  accountId: string;
  handle: string;
  type: AccountType;
  /** Base58 Solana address belonging to this account. */
  publicKey: string;
  kycStatus: KycStatus;
  createdAt: string;
}

/** How much of one asset the account holds, already decrypted for you. */
export interface Balance {
  asset: Asset;
  /** Quantity as a decimal string such as `"310.75"`, kept as text to avoid float rounding. */
  amount: string;
}

export interface BalancesResponse {
  balances: Balance[];
}

/** A sub-account that an automated agent spends from, owned by your account. */
export interface AgentAccount {
  accountId: string;
  handle: string;
  publicKey: string;
  status: AgentStatus;
  spendPolicyId: string;
}

/** Limits checked on-chain by the agent's smart account before any payment it makes goes through. */
export interface SpendPolicy {
  /** Most the agent can spend across any 24-hour window, counted in USDG. */
  dailyLimitUsdg: number;
  /** Ceiling for any one payment, counted in USDG. */
  perTransactionLimitUsdg: number;
  /** Handles or domains the agent may pay. Wildcard patterns like `*.example.org` are accepted. */
  allowedRecipients: string[];
  /** Which assets the agent can send. The server assumes `["USDG"]`; `USDC` and `SOL` may be added. */
  assets: Asset[];
  /** Daily time range when payments are permitted, written like `"09:00-17:30"`. */
  activeHours: string;
  /** Payments larger than this USDG amount wait for a person to approve them. */
  hitlThresholdUsdg: number;
}

export interface SpendPolicyRecord extends SpendPolicy {
  policyId: string;
  updatedAt: string;
}

export interface CreateAgentParams {
  name: string;
  spendPolicy: SpendPolicy;
}

/** A payment, whether still pending, confirmed or failed. */
export interface Transfer {
  transferId: string;
  status: TransferStatus;
  from?: string;
  to: string;
  confidential: boolean;
  /** Base58 signature of the Solana transaction that carried the payment. */
  txSignature: string;
  createdAt: string;
  confirmedAt?: string;
}

export interface CreateTransferParams {
  /** Who receives the funds: an `@handle` or a base58 Solana address. */
  to: string;
  /** How much to send, written as a decimal string like `"20.00"`. */
  amount: string;
  /** Asset to send. The server uses `USDG` when this is left out. */
  asset?: Asset;
  /**
   * Whether the amount is encrypted on-chain. Treated as `true` unless you
   * pass `false`, which you should only do for recipient wallets that can't
   * handle Veiled confidential tokens.
   */
  confidential?: boolean;
  /** Optional note, stored encrypted so only the two parties can read it. */
  memo?: string;
}

export interface ListTransfersParams {
  /** Page size, up to `100`. The server returns `20` when unset. */
  limit?: number;
  offset?: number;
  status?: TransferStatus;
  /** Lower time bound as an ISO 8601 string; earlier transfers are excluded. */
  from?: string;
  /** Upper time bound as an ISO 8601 string; later transfers are excluded. */
  to?: string;
}

export interface TransferList {
  transfers: Transfer[];
}

/** An agent payment parked until a person approves or rejects it. */
export interface PendingTransaction {
  transactionId: string;
  agent: string;
  to: string;
  requestedAt: string;
  expiresAt: string;
}

export interface PendingTransactionList {
  pending: PendingTransaction[];
}

export type WebhookEvent =
  | "transfer.initiated"
  | "transfer.confirmed"
  | "transfer.failed"
  | "agent.transaction.pending_approval"
  | "agent.transaction.approved"
  | "agent.transaction.rejected"
  | "agent.policy.updated"
  | (string & {});

export type TransferDirection = "sent" | "received";

/**
 * Contents of a webhook notification after parsing. There is deliberately no
 * amount field. Amounts live encrypted on-chain where Veiled itself can't see
 * them, so if you need one, decrypt it on your side with your own key.
 */
export interface WebhookEventPayload {
  event: WebhookEvent;
  /** Handle of the account involved, for instance `@northwind/billing-agent`. */
  account: string;
  direction?: TransferDirection;
  counterparty?: string;
  asset?: Asset;
  confidential?: boolean;
  txSignature?: string;
  timestamp: string;
}

/** Record of sending one event to your endpoint, taken from the recent log. */
export interface WebhookDelivery {
  eventId: string;
  event: WebhookEvent;
  /** Status code your server replied with; `0` means it could not be reached. */
  responseStatus: number;
  /** Total tries for this event, counting the original send. */
  attempts: number;
  lastAttemptAt: string;
}

export interface WebhookDeliveryList {
  deliveries: WebhookDelivery[];
}

export interface Webhook {
  webhookId: string;
  url: string;
  events: WebhookEvent[];
  createdAt: string;
}

/** What `create` gives back. Save `secret` now, since later reads omit it. */
export interface WebhookWithSecret extends Webhook {
  secret: string;
}

export interface CreateWebhookParams {
  url: string;
  events: WebhookEvent[];
}

export interface WebhookList {
  webhooks: Webhook[];
}
