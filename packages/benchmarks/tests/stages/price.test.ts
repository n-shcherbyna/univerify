// packages/benchmarks/tests/stages/price.test.ts
import { describe, it, expect } from "vitest";
import tiny from "../fixtures/price-history/tiny-prices.json";
import { derivePercentiles } from "../../src/stages/price.js";

describe("derivePercentiles", () => {
  it("returns p10/p50/p90 for basefee and blob basefee in wei (bigint)", () => {
    const { basefee, blobBasefee } = derivePercentiles(tiny);
    expect(basefee.p10).toBe(10_000_000_000n);
    expect(basefee.p50).toBe(30_000_000_000n);
    expect(basefee.p90).toBe(50_000_000_000n);
    expect(blobBasefee.p10).toBe(1_000_000_000n);
    expect(blobBasefee.p50).toBe(3_000_000_000n);
    expect(blobBasefee.p90).toBe(5_000_000_000n);
  });
});

import { fakeExponential } from "../../src/stages/price.js";

describe("fakeExponential (EIP-4844)", () => {
  it("returns the factor when numerator is 0", () => {
    // f(factor, 0, denominator) = factor
    expect(fakeExponential(1n, 0n, 3338477n)).toBe(1n);
  });

  it("computes blob basefee at minimum (excessBlobGas = 0)", () => {
    // MIN_BASE_FEE_PER_BLOB_GAS = 1 wei (EIP-4844)
    expect(fakeExponential(1n, 0n, 3338477n)).toBe(1n);
  });

  it("monotonically increases with excessBlobGas", () => {
    const low = fakeExponential(1n, 1_000_000n, 3338477n);
    const high = fakeExponential(1n, 5_000_000n, 3338477n);
    expect(high).toBeGreaterThan(low);
  });
});

describe("derivePercentiles migration guard", () => {
  it("throws a clear error when price history predates blob support", () => {
    const old = {
      source: "eth_feeHistory",
      fetchedAt: "2026-04-19T12:00:00Z",
      windowDays: 90,
      samples: [{ blockNumber: 100, baseFeePerGas: "10000000000" }],
    };
    expect(() => derivePercentiles(old as never)).toThrow(/predates blob basefee/);
  });
});
