// packages/benchmarks/tests/stages/price.test.ts
import { describe, it, expect } from "vitest";
import tiny from "../fixtures/price-history/tiny-prices.json";
import { derivePercentiles } from "../../src/stages/price.js";

describe("derivePercentiles", () => {
  it("returns p10/p50/p90 of sampled basefees in wei (bigint)", () => {
    const { p10, p50, p90 } = derivePercentiles(tiny);
    expect(p10).toBe(10_000_000_000n);
    expect(p50).toBe(30_000_000_000n);
    expect(p90).toBe(50_000_000_000n);
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
