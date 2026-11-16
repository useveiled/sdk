import type { HttpClient, RequestConfig } from "../transport.js";
import type {
  AgentAccount,
  CreateAgentParams,
  PendingTransaction,
  PendingTransactionList,
  SpendPolicy,
  SpendPolicyRecord,
} from "../models.js";

/**
 * Endpoints for agent accounts: creating them, reading and changing the spend
 * policy enforced on-chain for each one, and deciding on payments that a
 * policy has paused until a person signs off.
 */
export class Agents {
  constructor(private readonly http: HttpClient) {}

  /**
   * Set up a new agent account beneath the account your API key belongs to.
   *
   * @param params The agent's name and the spend policy it starts with.
   * @returns The newly created agent account.
   * @example
   * ```ts
   * const agent = await veiled.agents.create({
   *   name: "invoice-runner",
   *   spendPolicy: {
   *     dailyLimitUsdg: 750,
   *     perTransactionLimitUsdg: 150,
   *     allowedRecipients: ["@acme-supplies", "*.example.org"],
   *     assets: ["USDG"],
   *     activeHours: "08:00-18:00",
   *     hitlThresholdUsdg: 100,
   *   },
   * });
   * ```
   */
  async create(params: CreateAgentParams, config: RequestConfig = {}): Promise<AgentAccount> {
    return this.http.request<AgentAccount>({
      method: "POST",
      path: "/v1/accounts/me/agents",
      body: params,
      ...config,
    });
  }

  /**
   * Read the spend policy currently in force for one agent.
   *
   * @param accountId The agent's account ID.
   * @example
   * ```ts
   * const policy = await veiled.agents.getSpendPolicy("acct_7Hq2");
   * console.log(policy.dailyLimitUsdg, policy.updatedAt);
   * ```
   */
  async getSpendPolicy(
    accountId: string,
    config: RequestConfig = {},
  ): Promise<SpendPolicyRecord> {
    return this.http.request<SpendPolicyRecord>({
      method: "GET",
      path: `/v1/agents/${encodeURIComponent(accountId)}/spend-policy`,
      ...config,
    });
  }

  /**
   * Change some or all of an agent's spend policy. Fields left out of `patch`
   * keep their current values. The new rules take effect starting with the
   * agent's next signed transaction.
   *
   * A payment is held for human review only when its value is strictly greater
   * than `hitlThresholdUsdg`; a payment exactly equal to the threshold goes
   * through without review.
   *
   * @param accountId The agent's account ID.
   * @param patch The policy fields to change.
   * @returns The full policy after the change is applied.
   * @example
   * ```ts
   * await veiled.agents.updateSpendPolicy("acct_7Hq2", { hitlThresholdUsdg: 40 });
   * ```
   */
  async updateSpendPolicy(
    accountId: string,
    patch: Partial<SpendPolicy>,
    config: RequestConfig = {},
  ): Promise<SpendPolicyRecord> {
    return this.http.request<SpendPolicyRecord>({
      method: "PATCH",
      path: `/v1/agents/${encodeURIComponent(accountId)}/spend-policy`,
      body: patch,
      ...config,
    });
  }

  /**
   * List every agent payment that is paused and waiting for a person to
   * approve or reject it, across all of your agents.
   *
   * @example
   * ```ts
   * const { pending } = await veiled.agents.listPendingTransactions();
   * for (const tx of pending) console.log(tx.agent, tx.to, tx.expiresAt);
   * ```
   */
  async listPendingTransactions(
    config: RequestConfig = {},
  ): Promise<PendingTransactionList> {
    return this.http.request<PendingTransactionList>({
      method: "GET",
      path: "/v1/agents/transactions/pending",
      ...config,
    });
  }

  /**
   * Let a paused payment go ahead. Once approved, it is signed and sent to
   * the network straight away.
   *
   * @param transactionId The ID of the held transaction.
   * @example
   * ```ts
   * await veiled.agents.approveTransaction("ptx_3kLm9");
   * ```
   */
  async approveTransaction(
    transactionId: string,
    config: RequestConfig = {},
  ): Promise<PendingTransaction> {
    return this.http.request<PendingTransaction>({
      method: "POST",
      path: `/v1/agents/transactions/${encodeURIComponent(transactionId)}/approve`,
      ...config,
    });
  }

  /**
   * Turn down a paused payment. It is dropped without being sent, so nothing
   * leaves the agent's account.
   *
   * @param transactionId The ID of the held transaction.
   * @example
   * ```ts
   * await veiled.agents.rejectTransaction("ptx_3kLm9");
   * ```
   */
  async rejectTransaction(
    transactionId: string,
    config: RequestConfig = {},
  ): Promise<PendingTransaction> {
    return this.http.request<PendingTransaction>({
      method: "POST",
      path: `/v1/agents/transactions/${encodeURIComponent(transactionId)}/reject`,
      ...config,
    });
  }
}
