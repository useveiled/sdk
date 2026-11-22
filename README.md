# @useveiled/sdk

Move money privately from TypeScript. `@useveiled/sdk` is the official client for [Veiled](https://useveiled.com), the confidential neobank on Solana for people and the AI agents that work for them.

Amounts are encrypted on chain, so neither the API nor this library ever hands you a plaintext figure it could have leaked. You keep your own keys. The SDK wraps the Veiled REST API with typed methods for four jobs:

- **Accounts**: look up the account behind your key, its balances and its agents.
- **Transfers**: send confidential payments, page through history and wait for settlement.
- **Agents**: give an AI agent its own account with spending rules the chain enforces.
- **Webhooks**: subscribe to events and verify every delivery's signature.

The API is in beta. It is stable enough to build on, but pin an exact version in your `package.json` so an upgrade never surprises you.

## Getting set up

```bash
npm install @useveiled/sdk
```

You need Node 18 or later, which supplies the global `fetch` and Web Crypto that the SDK relies on. The package ships both ES module and CommonJS builds with bundled type definitions, and it also runs in browsers and edge runtimes. Keep live keys on the server, though: anyone who sees one can spend from your account.

## Your first payment

Create a client with an API key, then send a transfer:

```ts
import { Veiled } from "@useveiled/sdk";

const veiled = new Veiled({ apiKey: process.env.VEILED_API_KEY! });

const payment = await veiled.transfers.create({
  to: "@harbor-coffee",
  amount: "42.75",
  asset: "USDG",
  memo: "Roastery order 1182",
});

console.log(payment.transferId, payment.status, payment.txSignature);
```

`asset` defaults to `USDG` and `confidential` defaults to `true`, so most calls only need `to` and `amount`. The recipient can be an `@handle` or a raw base58 address. The memo is encrypted and only the two parties can read it.

### Making it safe to retry

Every `transfers.create` call sends an `Idempotency-Key` header. If you don't supply one, the SDK generates a random key for that call. Pass your own, such as an order ID, and a retry after a crash or restart can never pay twice, because two calls with the same key produce at most one transfer:

```ts
await veiled.transfers.create(
  { to: "@harbor-coffee", amount: "42.75" },
  { idempotencyKey: "order-1182" },
);
```

### Waiting for settlement

Settlement on Solana usually takes less than a second. `waitForConfirmation` polls until the transfer is no longer `pending` and returns it:

```ts
const settled = await veiled.transfers.waitForConfirmation(payment.transferId, {
  pollIntervalMs: 500, // default 1000
  maxWaitMs: 20_000,   // default 60000
});

if (settled.status === "failed") {
  // decide whether to try again
}
```

It resolves for both `confirmed` and `failed`, so always check `status`. It throws a `VeiledError` only if the transfer is still pending when `maxWaitMs` runs out, or if you abort it through `signal`.

## Keys and environments

Requests authenticate with a bearer API key that you create on the **API Keys** page, under **Developer** in the Veiled app's sidebar. The prefix decides which network the key works on, and the client reads it for you:

| Prefix | Network | `veiled.environment` |
|---|---|---|
| `vl_live_` | Solana mainnet, real USDG | `"live"` |
| `vl_test_` | Solana devnet, no real funds | `"test"` |

```ts
const sandbox = new Veiled({ apiKey: process.env.VEILED_TEST_KEY! });

if (sandbox.environment !== "test") {
  throw new Error("Refusing to run the test suite against a live key");
}
```

Any key that doesn't start with `vl_test_` is reported as `"live"`. Treat keys like private keys: load them from the environment or a secrets manager, use a separate key per deployment, and rotate one the moment it might have leaked.

## Client options

```ts
const veiled = new Veiled({
  apiKey: process.env.VEILED_API_KEY!,
  baseUrl: "https://api.useveiled.com",
  timeoutMs: 15_000,
  maxRetries: 4,
  fetch: myInstrumentedFetch,
});
```

| Option | Default | What it does |
|---|---|---|
| `apiKey` | required | Your `vl_live_` or `vl_test_` key. The constructor throws a `VeiledError` without it. |
| `baseUrl` | `https://api.useveiled.com` | Where requests go. Change it to route through your own gateway. |
| `timeoutMs` | `30000` | Time limit for each individual HTTP request. |
| `maxRetries` | `2` | Extra attempts after a transient failure. `0` turns retries off. |
| `fetch` | global `fetch` | A custom `fetch` implementation, for proxies, tracing or tests. |

Requests go out with a `User-Agent` of `veiled-sdk/<version>`.

## Method reference

The client exposes four resource namespaces. The SDK speaks camelCase and converts to and from the API's snake_case for you, in both request bodies and responses.

Every method takes an optional final `RequestConfig` argument, `{ signal?: AbortSignal; timeoutMs?: number }`. In `transfers.create` and `transfers.waitForConfirmation` that last argument also carries the extra options shown above.

### `veiled.accounts`

| Method | Returns |
|---|---|
| `me()` | `Account`: `accountId`, `handle`, `type`, `publicKey`, `kycStatus`, `createdAt` |
| `balances({ decryptionProof? })` | `{ balances: Balance[] }`, each `{ asset, amount }` |
| `listAgents()` | `{ agents: AgentAccount[] }` |

### `veiled.transfers`

| Method | Returns |
|---|---|
| `create(params, { idempotencyKey? })` | `Transfer` |
| `get(transferId)` | `Transfer` |
| `list({ limit?, offset?, status?, from?, to? })` | `{ transfers: Transfer[] }`, newest first |
| `iterate({ limit?, status?, from?, to? })` | async iterator over every matching `Transfer` |
| `waitForConfirmation(transferId, { pollIntervalMs?, maxWaitMs? })` | `Transfer` once it leaves `pending` |

A `Transfer` has `transferId`, `status` (`pending`, `confirmed` or `failed`), `to`, `confidential`, `txSignature`, `createdAt`, and optionally `from` and `confirmedAt`. For `list`, `limit` defaults to `20` with a maximum of `100`, and `from` and `to` are ISO 8601 timestamps. `iterate` fetches pages of 100 unless you set `limit`, and stops requesting pages as soon as you break out of the loop:

```ts
const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

for await (const t of veiled.transfers.iterate({ status: "confirmed", from: since })) {
  console.log(t.createdAt, t.to, t.txSignature);
}
```

### `veiled.agents`

| Method | Returns |
|---|---|
| `create({ name, spendPolicy })` | `AgentAccount`: `accountId`, `handle`, `publicKey`, `status`, `spendPolicyId` |
| `getSpendPolicy(accountId)` | `SpendPolicyRecord` (the policy plus `policyId` and `updatedAt`) |
| `updateSpendPolicy(accountId, patch)` | `SpendPolicyRecord` |
| `listPendingTransactions()` | `{ pending: PendingTransaction[] }` |
| `approveTransaction(transactionId)` | `PendingTransaction` |
| `rejectTransaction(transactionId)` | `PendingTransaction` |

### `veiled.webhooks`

| Method | Returns |
|---|---|
| `create({ url, events })` | `WebhookWithSecret` (the only time `secret` is returned) |
| `list()` | `{ webhooks: Webhook[] }` |
| `delete(webhookId)` | nothing; deletion is immediate |
| `replay(webhookId, eventId)` | nothing; resends that event to the endpoint |
| `deliveries(webhookId)` | `{ deliveries: WebhookDelivery[] }` |
| `verifySignature({ payload, signature, secret })` | `Promise<boolean>` |
| `constructEvent({ payload, signature, secret })` | `Promise<WebhookEventPayload>` |

## Reading encrypted balances

Veiled's servers can't decrypt what you hold, and that shapes two parts of the API:

- No transfer, balance or webhook response contains a plaintext transfer amount, not even the response to the call that set it.
- `accounts.balances()` only reports amounts when you pass a `decryptionProof` that you generated on the client with your account key. Without one, you learn which assets have a non-zero balance and nothing more.

```ts
const { balances } = await veiled.accounts.balances({ decryptionProof: proof });

for (const { asset, amount } of balances) {
  console.log(`${asset}: ${amount}`); // amount is a decimal string, e.g. "3810.40"
}
```

## Agents with guardrails

An agent account belongs to your account and has its own spend policy. The policy lives in a smart account on chain and is checked before the agent can sign, so neither a misbehaving agent nor a compromised server can get around it.

```ts
const scout = await veiled.agents.create({
  name: "pricing-scout",
  spendPolicy: {
    dailyLimitUsdg: 300,
    perTransactionLimitUsdg: 40,
    allowedRecipients: ["@datafeed-labs", "*.weatherapi.io"],
    assets: ["USDG", "USDC"],
    activeHours: "06:00-22:00",
    hitlThresholdUsdg: 15,
  },
});
```

| Field | Meaning |
|---|---|
| `dailyLimitUsdg` | Rolling 24 hour spending cap, in USDG |
| `perTransactionLimitUsdg` | Cap on any single payment, in USDG |
| `allowedRecipients` | Handles or domains the agent may pay; wildcards such as `*.weatherapi.io` work |
| `assets` | Assets the agent may spend: `USDG` (the default), `USDC` or `SOL` |
| `activeHours` | Daily window in which the agent may transact, for example `"06:00-22:00"` |
| `hitlThresholdUsdg` | Payments worth strictly more than this wait for a human. A payment exactly equal to it goes through on its own. |

To change a policy later, send only the fields you want to change. The new rules apply from the agent's next transaction:

```ts
await veiled.agents.updateSpendPolicy(scout.accountId, { dailyLimitUsdg: 450 });
```

Payments held by the threshold wait for you to decide. Approving one signs and submits it right away; rejecting one discards it and no funds move:

```ts
const { pending } = await veiled.agents.listPendingTransactions();

for (const held of pending) {
  if (held.to === "@datafeed-labs") {
    await veiled.agents.approveTransaction(held.transactionId);
  } else {
    await veiled.agents.rejectTransaction(held.transactionId);
  }
}
```

Each held transaction has `transactionId`, `agent`, `to`, `requestedAt` and `expiresAt`. Once `expiresAt` passes, the approval window is closed and the API answers with `transaction_expired`.

## Receiving webhooks

Subscribe to the events you care about and save the secret from the response. It is never shown again:

```ts
const hook = await veiled.webhooks.create({
  url: "https://ops.example.com/veiled/events",
  events: ["transfer.confirmed", "transfer.failed", "agent.transaction.pending_approval"],
});

await saveSecret("veiled-webhook", hook.secret);
```

The available events are `transfer.initiated`, `transfer.confirmed`, `transfer.failed`, `agent.transaction.pending_approval`, `agent.transaction.approved`, `agent.transaction.rejected` and `agent.policy.updated`.

Each delivery carries an `X-Veiled-Signature` header: a hex HMAC-SHA256 of the raw body, keyed with your secret. `constructEvent` checks it in constant time and returns the parsed, camelCased payload. If the signature doesn't match or the body isn't valid JSON, it throws `VeiledWebhookVerificationError`. Hand it the body exactly as it arrived, as a string or bytes. A body that has been parsed and re-serialized won't match.

```ts
import express from "express";
import { Veiled, VeiledWebhookVerificationError } from "@useveiled/sdk";

const veiled = new Veiled({ apiKey: process.env.VEILED_API_KEY! });
const app = express();

app.post(
  "/veiled/events",
  express.raw({ type: "application/json" }),
  async (req, res) => {
    try {
      const event = await veiled.webhooks.constructEvent({
        payload: req.body, // a Buffer, which is a Uint8Array
        signature: req.header("x-veiled-signature") ?? "",
        secret: process.env.VEILED_WEBHOOK_SECRET!,
      });

      if (event.event === "transfer.confirmed") {
        await markPaid(event.txSignature);
      } else if (event.event === "agent.transaction.pending_approval") {
        await pageOnCall(event.account);
      }

      res.sendStatus(200);
    } catch (err) {
      if (err instanceof VeiledWebhookVerificationError) {
        res.sendStatus(400);
        return;
      }
      throw err;
    }
  },
);
```

A payload has `event`, `account` and `timestamp`, and may include `direction` (`sent` or `received`), `counterparty`, `asset`, `confidential` and `txSignature`. Amounts are never included.

If you just want a yes or no, `veiled.webhooks.verifySignature(...)` takes the same arguments and resolves to `true` or `false` without throwing on a mismatch. The same check is also exported as a standalone function, so you can verify deliveries without building a client or holding an API key:

```ts
import { verifyWebhookSignature } from "@useveiled/sdk";

const ok = await verifyWebhookSignature({ payload: rawBody, signature, secret });
```

Both throw a `VeiledError` if the runtime has no Web Crypto.

To debug an endpoint, `webhooks.deliveries(webhookId)` lists recent attempts with `eventId`, `event`, `responseStatus` (`0` means your endpoint couldn't be reached), `attempts` and `lastAttemptAt`. `webhooks.replay(webhookId, eventId)` sends one of those events again.

## Handling errors

Every error the SDK throws extends `VeiledError`, so you can catch them all in one place or narrow to the class you care about:

| Class | When it is thrown | Extra properties |
|---|---|---|
| `VeiledAPIError` | The API returned a non-2xx status | `status`, `code`, `body`, `requestId` |
| `VeiledConnectionError` | No response arrived: network failure, timeout or abort | `cause` |
| `VeiledWebhookVerificationError` | `webhooks.constructEvent` rejected a delivery | none |
| `VeiledError` | The base class, also thrown directly for a missing API key, missing `fetch` or Web Crypto, or a `waitForConfirmation` that timed out or was aborted | none |

```ts
import { VeiledAPIError, VeiledConnectionError } from "@useveiled/sdk";

try {
  await veiled.transfers.create({ to: "@harbor-coffee", amount: "9800.00" });
} catch (err) {
  if (err instanceof VeiledAPIError) {
    if (err.code === "recipient_not_confidential_ready") {
      // the payee can't receive confidential tokens yet
    } else {
      console.error(err.status, err.code, err.requestId);
    }
  } else if (err instanceof VeiledConnectionError) {
    // nothing came back; safe to retry with the same idempotency key
  } else {
    throw err;
  }
}
```

`code` is typed as `VeiledErrorCode`. The API currently returns:

| Code | Status |
|---|---|
| `invalid_request` | 400 |
| `invalid_policy` | 400 |
| `unauthorized` | 401 |
| `insufficient_balance` | 402 |
| `kyc_required` | 403 |
| `not_agent_owner` | 403 |
| `recipient_not_found` | 404 |
| `transaction_not_found` | 404 |
| `transaction_expired` | 409 |
| `decryption_proof_invalid` | 422 |
| `recipient_not_confidential_ready` | 422 |

If an error body has no code, `code` is `"unknown_error"`. Quote `requestId` (from the `x-request-id` header) when you contact support.

## Retries, timeouts and cancellation

A request is retried after a network error or a `408`, `429`, `500`, `502`, `503` or `504`, up to `maxRetries` times. The delay grows exponentially with jitter (about 500 ms, then 1 s, then 2 s, capped at 8 s). If the response has a `Retry-After` header of 60 seconds or less, in seconds or as an HTTP date, that delay is used instead.

Only requests that are safe to repeat are retried: `GET` and `DELETE` calls, plus `transfers.create`, which carries an idempotency key. Every other `POST` and `PATCH`, such as `agents.create`, `approveTransaction` or `webhooks.create`, is attempted once, so a dropped connection can't apply it twice.

Override the timeout or cancel a single call through its last argument. Aborting stops the request along with any retries still to come:

```ts
const controller = new AbortController();
setTimeout(() => controller.abort(), 3_000);

const { transfers } = await veiled.transfers.list(
  { status: "pending", limit: 50 },
  { signal: controller.signal, timeoutMs: 2_000 },
);
```

## Further reading

The full REST reference lives at [docs.useveiled.com](https://docs.useveiled.com):

- [Making Authenticated Requests](https://docs.useveiled.com/developer-api/making-requests)
- [Reading Accounts and Balances](https://docs.useveiled.com/developer-api/reading-accounts)
- [Sending Payments](https://docs.useveiled.com/developer-api/sending-payments)
- [Managing Agents and Policies](https://docs.useveiled.com/developer-api/managing-agents)
- [Webhook Delivery and Signatures](https://docs.useveiled.com/developer-api/webhook-delivery)
- [Spending Guardrails](https://docs.useveiled.com/autonomous-agents/spending-guardrails)

Report bugs at [github.com/useveiled/sdk/issues](https://github.com/useveiled/sdk/issues). Follow [@useveiled](https://x.com/useveiled) for release news.

## License

MIT. See [LICENSE](./LICENSE).
