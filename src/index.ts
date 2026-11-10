export { Veiled } from "./veiled.js";
export type { VeiledOptions, Environment } from "./veiled.js";
export type { RequestConfig } from "./transport.js";

export {
  VeiledError,
  VeiledAPIError,
  VeiledConnectionError,
  VeiledWebhookVerificationError,
} from "./failures.js";
export type { VeiledErrorCode } from "./failures.js";

export { verifyWebhookSignature } from "./signing.js";

export { Accounts } from "./endpoints/accounts.js";
export { Transfers } from "./endpoints/transfers.js";
export type {
  CreateTransferOptions,
  WaitForConfirmationOptions,
} from "./endpoints/transfers.js";
export { Agents } from "./endpoints/agents.js";
export { Webhooks } from "./endpoints/webhooks.js";

export type * from "./models.js";
