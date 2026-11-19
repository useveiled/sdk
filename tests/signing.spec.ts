import { describe, expect, it } from "vitest";
import { VeiledWebhookVerificationError } from "../src/failures.js";
import { Webhooks } from "../src/endpoints/webhooks.js";
import { verifyWebhookSignature } from "../src/signing.js";
import type { HttpClient } from "../src/transport.js";

const SECRET = "whsec_test_secret";

async function sign(payload: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

describe("verifyWebhookSignature()", () => {
  it("resolves true for a correct HMAC of a string body", async () => {
    const payload = JSON.stringify({ event: "transfer.confirmed" });
    const signature = await sign(payload, SECRET);
    await expect(
      verifyWebhookSignature({ payload, signature, secret: SECRET }),
    ).resolves.toBe(true);
  });

  it("resolves true when the body is given as bytes", async () => {
    const payload = JSON.stringify({ event: "transfer.confirmed" });
    const signature = await sign(payload, SECRET);
    await expect(
      verifyWebhookSignature({
        payload: new TextEncoder().encode(payload),
        signature,
        secret: SECRET,
      }),
    ).resolves.toBe(true);
  });

  it("ignores letter case and padding spaces in the signature", async () => {
    const payload = "{}";
    const signature = (await sign(payload, SECRET)).toUpperCase();
    await expect(
      verifyWebhookSignature({ payload, signature: ` ${signature} `, secret: SECRET }),
    ).resolves.toBe(true);
  });

  it("resolves false once the body has been altered after signing", async () => {
    const signature = await sign('{"amount":"1.00"}', SECRET);
    await expect(
      verifyWebhookSignature({
        payload: '{"amount":"9999.00"}',
        signature,
        secret: SECRET,
      }),
    ).resolves.toBe(false);
  });

  it("resolves false when a different secret produced the signature", async () => {
    const payload = "{}";
    const signature = await sign(payload, "some_other_secret");
    await expect(
      verifyWebhookSignature({ payload, signature, secret: SECRET }),
    ).resolves.toBe(false);
  });
});

describe("Webhooks#constructEvent()", () => {
  const webhooks = new Webhooks({} as HttpClient);

  it("checks the signature, then parses the body into a camelCase event", async () => {
    const payload = JSON.stringify({
      event: "transfer.confirmed",
      account: "@me",
      tx_signature: "sig123",
      timestamp: "2026-01-01T00:00:00Z",
    });
    const signature = await sign(payload, SECRET);

    const event = await webhooks.constructEvent({
      payload,
      signature,
      secret: SECRET,
    });
    expect(event.event).toBe("transfer.confirmed");
    expect(event.txSignature).toBe("sig123");
  });

  it("rejects with a verification error when the signature does not match", async () => {
    await expect(
      webhooks.constructEvent({
        payload: "{}",
        signature: "0".repeat(64),
        secret: SECRET,
      }),
    ).rejects.toBeInstanceOf(VeiledWebhookVerificationError);
  });

  it("rejects with a verification error when a correctly signed body fails to parse", async () => {
    const payload = "not json";
    const signature = await sign(payload, SECRET);
    await expect(
      webhooks.constructEvent({ payload, signature, secret: SECRET }),
    ).rejects.toBeInstanceOf(VeiledWebhookVerificationError);
  });
});
