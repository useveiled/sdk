import { describe, expect, it, vi } from "vitest";
import { VeiledError } from "../src/failures.js";
import { Transfers } from "../src/endpoints/transfers.js";
import type { HttpClient, RequestOptions } from "../src/transport.js";
import type { Transfer } from "../src/models.js";

function makeTransfer(overrides: Partial<Transfer> = {}): Transfer {
  return {
    transferId: "tr_1",
    status: "confirmed",
    to: "@vendor",
    confidential: true,
    txSignature: "sig",
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function stubHttp(impl: (options: RequestOptions) => unknown) {
  const request = vi.fn(async (options: RequestOptions) => impl(options));
  return { http: { request } as unknown as HttpClient, request };
}

describe("Transfers#create()", () => {
  it("adds its own Idempotency-Key header and flags the call as retryable", async () => {
    const { http, request } = stubHttp(() => makeTransfer());
    await new Transfers(http).create({ to: "@vendor", amount: "1.00" });

    const options = request.mock.calls[0]![0];
    expect(options.idempotent).toBe(true);
    const key = options.headers?.["Idempotency-Key"];
    expect(key).toBeTruthy();
  });

  it("sends the idempotencyKey option as the header value when one is given", async () => {
    const { http, request } = stubHttp(() => makeTransfer());
    await new Transfers(http).create(
      { to: "@vendor", amount: "1.00" },
      { idempotencyKey: "invoice-4471" },
    );
    expect(request.mock.calls[0]![0].headers?.["Idempotency-Key"]).toBe(
      "invoice-4471",
    );
  });
});

describe("Transfers#iterate()", () => {
  it("keeps requesting by offset and finishes after a page smaller than the limit", async () => {
    const pageA = Array.from({ length: 3 }, (_, i) =>
      makeTransfer({ transferId: `tr_${i}` }),
    );
    const pageB = [makeTransfer({ transferId: "tr_last" })];
    const { http, request } = stubHttp((options) =>
      options.query?.offset === 0 ? { transfers: pageA } : { transfers: pageB },
    );

    const seen: string[] = [];
    for await (const transfer of new Transfers(http).iterate({ limit: 3 })) {
      seen.push(transfer.transferId);
    }

    expect(seen).toEqual(["tr_0", "tr_1", "tr_2", "tr_last"]);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0].query?.offset).toBe(3);
  });

  it("makes no further requests after the loop exits with break", async () => {
    const page = Array.from({ length: 2 }, (_, i) =>
      makeTransfer({ transferId: `tr_${i}` }),
    );
    const { http, request } = stubHttp(() => ({ transfers: page }));

    for await (const transfer of new Transfers(http).iterate({ limit: 2 })) {
      if (transfer.transferId === "tr_0") break;
    }
    expect(request).toHaveBeenCalledTimes(1);
  });
});

describe("Transfers#waitForConfirmation()", () => {
  it("fetches the transfer repeatedly until its status is no longer pending", async () => {
    let calls = 0;
    const { http } = stubHttp(() =>
      makeTransfer({ status: ++calls < 3 ? "pending" : "confirmed" }),
    );

    const transfer = await new Transfers(http).waitForConfirmation("tr_1", {
      pollIntervalMs: 1,
    });
    expect(transfer.status).toBe("confirmed");
    expect(calls).toBe(3);
  });

  it("resolves with the transfer when it settles as failed", async () => {
    const { http } = stubHttp(() => makeTransfer({ status: "failed" }));
    const transfer = await new Transfers(http).waitForConfirmation("tr_1");
    expect(transfer.status).toBe("failed");
  });

  it("rejects with VeiledError when maxWaitMs runs out before it settles", async () => {
    const { http } = stubHttp(() => makeTransfer({ status: "pending" }));

    await expect(
      new Transfers(http).waitForConfirmation("tr_1", {
        pollIntervalMs: 5,
        maxWaitMs: 20,
      }),
    ).rejects.toBeInstanceOf(VeiledError);
  });
});
