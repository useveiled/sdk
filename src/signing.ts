import { VeiledError } from "./failures.js";

/**
 * Checks that a webhook delivery really came from Veiled. The
 * `X-Veiled-Signature` header holds a hex HMAC-SHA256 of the unmodified body,
 * keyed with your endpoint secret; this recomputes it and compares the two in
 * constant time so the check reveals nothing through response timing.
 * Runs anywhere the Web Crypto API exists, which includes Node 18 and later,
 * current browsers and edge platforms.
 *
 * @param params.payload The body exactly as received, before any JSON parsing.
 * @param params.signature The `X-Veiled-Signature` header value. Case and surrounding whitespace are ignored.
 * @param params.secret The signing secret returned when the webhook was created.
 * @returns `true` when the signature matches, `false` otherwise.
 * @throws {VeiledError} If `crypto.subtle` is missing from the runtime.
 *
 * @example
 * ```ts
 * const ok = await verifyWebhookSignature({
 *   payload: rawBody,
 *   signature: req.headers["x-veiled-signature"] as string,
 *   secret: process.env.VEILED_HOOK_SECRET!,
 * });
 * if (!ok) return res.status(400).end();
 * ```
 */
export async function verifyWebhookSignature(params: {
  payload: string | Uint8Array;
  signature: string;
  secret: string;
}): Promise<boolean> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new VeiledError(
      "Webhook signatures cannot be checked here because this runtime lacks the Web Crypto API (crypto.subtle).",
    );
  }

  const encoder = new TextEncoder();
  const key = await subtle.importKey(
    "raw",
    encoder.encode(params.secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const data =
    typeof params.payload === "string" ? encoder.encode(params.payload) : params.payload;
  const digest = await subtle.sign("HMAC", key, data as BufferSource);
  const expected = toHex(new Uint8Array(digest));

  return timingSafeEqual(expected, params.signature.trim().toLowerCase());
}

function toHex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}
