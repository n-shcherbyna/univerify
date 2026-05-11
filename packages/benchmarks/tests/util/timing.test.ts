// packages/benchmarks/tests/util/timing.test.ts
import { describe, it, expect } from "vitest";
import { percentile, trimmedMean, sortAsc } from "../../src/util/timing.js";

describe("percentile", () => {
  it("returns the kth percentile of a sorted copy of samples", () => {
    const samples = [100, 50, 300, 200, 150];
    expect(percentile(samples, 0.5)).toBe(150);
    expect(percentile(samples, 0.95)).toBeGreaterThanOrEqual(200);
  });

  it("throws on empty input", () => {
    expect(() => percentile([], 0.5)).toThrow();
  });
});

describe("trimmedMean", () => {
  it("drops top and bottom proportionally", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // 20% trim on each side → drops 1,2 and 9,10
    expect(trimmedMean(samples, 0.2)).toBe((3 + 4 + 5 + 6 + 7 + 8) / 6);
  });
});

describe("sortAsc", () => {
  it("returns ascending copy without mutating input", () => {
    const input = [3, 1, 2];
    const sorted = sortAsc(input);
    expect(sorted).toEqual([1, 2, 3]);
    expect(input).toEqual([3, 1, 2]);
  });
});
