import { camelizeKeys } from "../casing.js";
import { VeiledWebhookVerificationError } from "../failures.js";
import type { HttpClient, RequestConfig } from "../transport.js";
import type {
  CreateWebhookParams,
  WebhookDeliveryList,
  WebhookEventPayload,
  WebhookList,
  WebhookWithSecret,
} from "../models.js";
import { verifyWebhookSignature } from "../signing.js";

/**
 * Endpoints for webhook subscriptions, plus helpers that check the signature
 * on each delivery your server receives.
 */
export class Webhooks {
  constructor(private readonly http: HttpClient) {}

  /**
   * Register an endpoint to receive the chosen events.
   *
   * The response includes a signing `secret` that the API will not return
   * again. Save it somewhere safe; you need it to check the
   * `X-Veiled-Signature` header on every delivery.
   *
   * @param params The endpoint URL and the events to send to it.
   * @example
   * ```ts
   * const hook = await veiled.webhooks.create({
   *   url: "https://hooks.example.org/veiled",
   *   events: ["transfer.confirmed", "agent.transaction.pending_approval"],
   * });
   * await saveSecret(hook.webhookId, hook.secret);
   * ```
   */
  async create(
    params: CreateWebhookParams,
    config: RequestConfig = {},
  ): Promise<WebhookWithSecret> {
    return this.http.request<WebhookWithSecret>({
      method: "POST",
      path: "/v1/webhooks",
      body: params,
      ...config,
    });
  }

  /**
   * Fetch all of your webhook subscriptions. Secrets are not included.
   *
   * @example
   * ```ts
   * const { webhooks } = await veiled.webhooks.list();
   * ```
   */
  async list(config: RequestConfig = {}): Promise<WebhookList> {
    return this.http.request<WebhookList>({
      method: "GET",
      path: "/v1/webhooks",
      ...config,
    });
  }

  /**
   * Remove a webhook subscription. It stops receiving events right away.
   *
   * @param webhookId The subscription's ID.
   * @example
   * ```ts
   * await veiled.webhooks.delete("wh_4Rt8x");
   * ```
   */
  async delete(webhookId: string, config: RequestConfig = {}): Promise<void> {
    await this.http.request<void>({
      method: "DELETE",
      path: `/v1/webhooks/${encodeURIComponent(webhookId)}`,
      ...config,
    });
  }

  /**
   * Ask the API to send an earlier event to this subscription's URL again.
   *
   * @param webhookId The subscription's ID.
   * @param eventId The ID of the event to send again.
   * @example
   * ```ts
   * await veiled.webhooks.replay("wh_4Rt8x", "evt_b51Qz");
   * ```
   */
  async replay(
    webhookId: string,
    eventId: string,
    config: RequestConfig = {},
  ): Promise<void> {
    await this.http.request<void>({
      method: "POST",
      path: `/v1/webhooks/${encodeURIComponent(webhookId)}/replay/${encodeURIComponent(eventId)}`,
      ...config,
    });
  }

  /**
   * Fetch recent delivery attempts for a subscription, including the status
   * code your endpoint returned and how many tries each one took.
   *
   * @param webhookId The subscription's ID.
   * @example
   * ```ts
   * const { deliveries } = await veiled.webhooks.deliveries("wh_4Rt8x");
   * const failing = deliveries.filter((d) => d.responseStatus >= 400);
   * ```
   */
  async deliveries(
    webhookId: string,
    config: RequestConfig = {},
  ): Promise<WebhookDeliveryList> {
    return this.http.request<WebhookDeliveryList>({
      method: "GET",
      path: `/v1/webhooks/${encodeURIComponent(webhookId)}/deliveries`,
      ...config,
    });
  }

  /**
   * Check whether the `X-Veiled-Signature` header matches a delivery's body.
   *
   * The HMAC is computed over the bytes exactly as they arrived. Hand over the
   * raw body; a parsed object that has been turned back into JSON will not match.
   *
   * @returns `true` if the signature is genuine, otherwise `false`.
   * @example
   * ```ts
   * const ok = await veiled.webhooks.verifySignature({
   *   payload: rawBody,
   *   signature: signatureHeader,
   *   secret: process.env.VEILED_WEBHOOK_SECRET!,
   * });
   * ```
   */
  verifySignature(params: {
    payload: string | Uint8Array;
    signature: string;
    secret: string;
  }): Promise<boolean> {
    return verifyWebhookSignature(params);
  }

  /**
   * Check a delivery's signature and, if it is genuine, parse the body into a
   * typed event with camelCase keys. Use this in place of `verifySignature`
   * followed by `JSON.parse` so that unverified data never reaches your code.
   *
   * As with `verifySignature`, pass the raw body exactly as received.
   *
   * @returns The parsed event payload.
   * @throws {VeiledWebhookVerificationError} If the signature is wrong or the
   * body cannot be parsed as JSON.
   * @example
   * ```ts
   * const event = await veiled.webhooks.constructEvent({
   *   payload: rawBody,
   *   signature: signatureHeader,
   *   secret: process.env.VEILED_WEBHOOK_SECRET!,
   * });
   * if (event.event === "transfer.confirmed") markPaid(event.txSignature);
   * ```
   */
  async constructEvent(params: {
    payload: string | Uint8Array;
    signature: string;
    secret: string;
  }): Promise<WebhookEventPayload> {
    const valid = await verifyWebhookSignature(params);
    if (!valid) {
      throw new VeiledWebhookVerificationError(
        "The webhook signature does not match the payload. Check that you are " +
          "using the right secret and the unmodified raw body; otherwise the " +
          "request may not have come from Veiled.",
      );
    }

    const raw =
      typeof params.payload === "string"
        ? params.payload
        : new TextDecoder().decode(params.payload);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new VeiledWebhookVerificationError(
        "The webhook body could not be parsed as JSON.",
      );
    }

    return camelizeKeys<WebhookEventPayload>(parsed);
  }
}
