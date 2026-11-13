import type { HttpClient, RequestConfig } from "../transport.js";
import type { Account, AgentAccount, BalancesResponse } from "../models.js";

/**
 * Endpoints for the account that owns the API key: its profile, its
 * balances, and the agent accounts that live beneath it.
 */
export class Accounts {
  constructor(private readonly http: HttpClient) {}

  /**
   * Fetch the profile of the account your API key belongs to.
   *
   * @returns The account's ID, handle, type, Solana address and KYC status.
   * @example
   * ```ts
   * const account = await veiled.accounts.me();
   * console.log(account.handle, account.kycStatus);
   * ```
   */
  async me(config: RequestConfig = {}): Promise<Account> {
    return this.http.request<Account>({
      method: "GET",
      path: "/v1/accounts/me",
      ...config,
    });
  }

  /**
   * Fetch per-asset balances for the account your API key belongs to.
   *
   * Balances are encrypted on-chain and Veiled has no way to read them. To get
   * actual amounts back, generate a decryption proof with your own key on the
   * client and pass it here. Without a proof, the response only tells you
   * which assets currently have a balance greater than zero.
   *
   * @param params.decryptionProof A proof built locally with your key.
   * @example
   * ```ts
   * const { balances } = await veiled.accounts.balances({ decryptionProof: proof });
   * for (const b of balances) console.log(`${b.asset}: ${b.amount}`);
   * ```
   */
  async balances(
    params?: { decryptionProof?: string },
    config: RequestConfig = {},
  ): Promise<BalancesResponse> {
    return this.http.request<BalancesResponse>({
      method: "GET",
      path: "/v1/accounts/me/balances",
      query: { decryptionProof: params?.decryptionProof },
      ...config,
    });
  }

  /**
   * Fetch all agent accounts that sit under the account your API key
   * belongs to.
   *
   * @example
   * ```ts
   * const { agents } = await veiled.accounts.listAgents();
   * console.log(agents.map((a) => a.handle));
   * ```
   */
  async listAgents(config: RequestConfig = {}): Promise<{ agents: AgentAccount[] }> {
    return this.http.request<{ agents: AgentAccount[] }>({
      method: "GET",
      path: "/v1/accounts/me/agents",
      ...config,
    });
  }
}
