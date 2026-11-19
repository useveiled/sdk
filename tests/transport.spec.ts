import { describe, expect, it, vi } from "vitest";
import { VeiledAPIError, VeiledConnectionError } from "../src/failures.js";
import { HttpClient } from "../src/transport.js";

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// Error response carrying "Retry-After: 0", so the client retries with no delay.
function failing(status: number, body: unknown = { code: "server_error", message: "boom" }) {
  return jsonResponse(status, body, { "Retry-After": "0" });
}

function makeClient(fetchImpl: typeof fetch, maxRetries = 2) {
  return new HttpClient({
    apiKey: "vl_test_key",
    baseUrl: "https://api.example.com",
    timeoutMs: 5_000,
    maxRetries,
    fetch: fetchImpl,
    userAgent: "veiled-sdk/test",
  });
}

describe("HttpClient retry behavior", () => {
  it("tries a GET again after a 503 and resolves with the later 200 body", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(failing(503))
      .mockResolvedValueOnce(jsonResponse(200, { transfer_id: "tr_1" }));

    const result = await makeClient(fetchMock).request<{ transferId: string }>({
      method: "GET",
      path: "/v1/transfers/tr_1",
    });

    expect(result.transferId).toBe("tr_1");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("rejects with the last API error once every retry is used up", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => failing(500));

    await expect(
      makeClient(fetchMock, 2).request({ method: "GET", path: "/v1/accounts/me" }),
    ).rejects.toMatchObject({ status: 500, code: "server_error" });
    expect(fetchMock).toHaveBeenCalledTimes(3); // one first try plus two retries
  });

  it("sends a non-idempotent POST only once even on a 500", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => failing(500));

    await expect(
      makeClient(fetchMock).request({ method: "POST", path: "/v1/webhooks", body: {} }),
    ).rejects.toBeInstanceOf(VeiledAPIError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("tries an idempotent POST again after a 429", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(failing(429))
      .mockResolvedValueOnce(jsonResponse(200, { ok: true }));

    await makeClient(fetchMock).request({
      method: "POST",
      path: "/v1/transfers",
      body: {},
      idempotent: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails right away on a 402 without retrying", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(402, { code: "insufficient_balance", message: "no" }));

    await expect(
      makeClient(fetchMock).request({ method: "GET", path: "/v1/accounts/me" }),
    ).rejects.toMatchObject({ status: 402, code: "insufficient_balance" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("makes no more attempts after the abort signal fires", async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      return failing(503);
    });

    await expect(
      makeClient(fetchMock).request({
        method: "GET",
        path: "/v1/accounts/me",
        signal: controller.signal,
      }),
    ).rejects.toBeInstanceOf(VeiledAPIError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("HttpClient request and response handling", () => {
  it("adds the bearer token, converts body and query keys to snake_case, and returns camelCase data", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse(200, { transfer_id: "tr_1", tx_signature: "sig" }));

    const result = await makeClient(fetchMock).request<{
      transferId: string;
      txSignature: string;
    }>({
      method: "POST",
      path: "/v1/transfers",
      body: { idempotencyExample: true, spendPolicy: { dailyLimitUsdg: 5 } },
      query: { pageSize: 10, missing: undefined },
      idempotent: true,
    });

    expect(result).toEqual({ transferId: "tr_1", txSignature: "sig" });

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toBe("https://api.example.com/v1/transfers?page_size=10");
    expect((init!.headers as Record<string, string>).Authorization).toBe(
      "Bearer vl_test_key",
    );
    expect(JSON.parse(init!.body as string)).toEqual({
      idempotency_example: true,
      spend_policy: { daily_limit_usdg: 5 },
    });
  });

  it("puts the x-request-id header value on the error and in its message", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse(500, {}, { "x-request-id": "req_123", "Retry-After": "0" }),
      );

    const err = await makeClient(fetchMock, 0)
      .request({ method: "GET", path: "/v1/accounts/me" })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(VeiledAPIError);
    expect((err as VeiledAPIError).requestId).toBe("req_123");
    expect((err as VeiledAPIError).message).toContain("req_123");
  });

  it("turns a rejected fetch into a VeiledConnectionError", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));

    await expect(
      makeClient(fetchMock, 0).request({ method: "GET", path: "/v1/accounts/me" }),
    ).rejects.toBeInstanceOf(VeiledConnectionError);
  });
});
