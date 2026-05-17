import { describe, it, expect } from "vitest";
import { createPrng, sampleWithoutReplacement } from "../../src/util/prng.js";

describe("createPrng", () => {
  it("is deterministic for the same seed", () => {
    const a = createPrng("test-seed");
    const b = createPrng("test-seed");
    expect(a.nextInt(0, 1000)).toBe(b.nextInt(0, 1000));
    expect(a.nextInt(0, 1000)).toBe(b.nextInt(0, 1000));
  });

  it("produces a different sequence for a different seed", () => {
    const a = createPrng("seed-a");
    const b = createPrng("seed-b");
    const xs = Array.from({ length: 10 }, () => a.nextInt(0, 1000));
    const ys = Array.from({ length: 10 }, () => b.nextInt(0, 1000));
    expect(xs).not.toEqual(ys);
  });

  it("nextInt respects bounds", () => {
    const r = createPrng("bounds");
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });
});

describe("sampleWithoutReplacement", () => {
  it("returns k unique indices in [0, n)", () => {
    const rng = createPrng("sample");
    const out = sampleWithoutReplacement(rng, 100, 30);
    expect(out).toHaveLength(30);
    expect(new Set(out).size).toBe(30);
    for (const i of out) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(100);
    }
  });

  it("is deterministic given the same seed", () => {
    const a = sampleWithoutReplacement(createPrng("x"), 100, 30);
    const b = sampleWithoutReplacement(createPrng("x"), 100, 30);
    expect(a).toEqual(b);
  });

  it("throws when k > n", () => {
    expect(() => sampleWithoutReplacement(createPrng("e"), 5, 10)).toThrow();
  });
});
