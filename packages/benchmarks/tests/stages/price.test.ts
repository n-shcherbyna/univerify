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
