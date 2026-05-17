// packages/benchmarks/src/util/prng.ts

/**
 * Seeded PRNG using Mulberry32. Deterministic given the same seed string.
 * Not cryptographically secure — fine for sampling indices.
 */
export type Prng = {
  next: () => number;
  nextInt: (lo: number, hi: number) => number;
};

function hashSeed(seed: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createPrng(seed: string): Prng {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nextInt = (lo: number, hi: number): number => {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error("nextInt: bounds must be integers");
    }
    if (hi <= lo) throw new Error("nextInt: hi must be > lo");
    return lo + Math.floor(next() * (hi - lo));
  };
  return { next, nextInt };
}

/**
 * Uniformly sample `k` distinct integers from `[0, n)` using Floyd's algorithm.
 * O(k) memory, O(n) time. Fine for n up to ~10^5.
 */
export function sampleWithoutReplacement(rng: Prng, n: number, k: number): number[] {
  if (k > n) throw new Error(`sampleWithoutReplacement: k=${k} > n=${n}`);
  const result = new Set<number>();
  for (let i = n - k; i < n; i++) {
    const j = rng.nextInt(0, i + 1);
    if (result.has(j)) result.add(i);
    else result.add(j);
  }
  return [...result];
}
