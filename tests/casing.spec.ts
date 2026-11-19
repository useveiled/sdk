import { describe, expect, it } from "vitest";
import { camelizeKeys, snakeifyKeys } from "../src/casing.js";

describe("snakeifyKeys (camelCase to snake_case)", () => {
  it("renames keys at every level of a nested object", () => {
    expect(
      snakeifyKeys({
        dailyLimitUsdg: 500,
        spendPolicy: { perTransactionLimitUsdg: 50 },
      }),
    ).toEqual({
      daily_limit_usdg: 500,
      spend_policy: { per_transaction_limit_usdg: 50 },
    });
  });

  it("renames keys on objects held inside an array", () => {
    expect(snakeifyKeys([{ txSignature: "abc" }])).toEqual([
      { tx_signature: "abc" },
    ]);
  });

  it("passes strings and existing snake_case keys through as they are", () => {
    expect(snakeifyKeys("plainString")).toBe("plainString");
    expect(snakeifyKeys({ already_snake: true })).toEqual({
      already_snake: true,
    });
  });

  it("leaves a Date value intact rather than recursing into it", () => {
    const date = new Date(0);
    expect(snakeifyKeys({ createdAt: date })).toEqual({ created_at: date });
  });
});

describe("camelizeKeys (snake_case to camelCase)", () => {
  it("renames keys on the top-level object and on nested ones", () => {
    expect(
      camelizeKeys({
        transfer_id: "tr_1",
        spend_policy: { hitl_threshold_usdg: 25 },
      }),
    ).toEqual({
      transferId: "tr_1",
      spendPolicy: { hitlThresholdUsdg: 25 },
    });
  });

  it("drops the underscore before a number", () => {
    expect(camelizeKeys({ line_2: "x" })).toEqual({ line2: "x" });
  });

  it("undoes snakeifyKeys exactly", () => {
    const original = {
      transferId: "tr_1",
      confidential: true,
      spendPolicy: { dailyLimitUsdg: 500, allowedRecipients: ["a", "b"] },
    };
    expect(camelizeKeys(snakeifyKeys(original))).toEqual(original);
  });
});
