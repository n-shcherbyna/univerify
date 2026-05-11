// packages/benchmarks/src/util/timing.ts

/** Returns ms since a monotonic epoch. Safe to diff; do NOT interpret as wall clock. */
export function now(): number {
  return performance.now();
}

export function sortAsc(samples: number[]): number[] {
  return [...samples].sort((a, b) => a - b);
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) throw new Error("percentile: empty samples");
  if (p < 0 || p > 1) throw new Error("percentile: p must be in [0, 1]");
  const s = sortAsc(samples);
  const idx = Math.min(s.length - 1, Math.floor(p * s.length));
  return s[idx];
}

export function trimmedMean(samples: number[], trim: number): number {
  if (samples.length === 0) throw new Error("trimmedMean: empty samples");
  if (trim < 0 || trim >= 0.5) throw new Error("trimmedMean: trim in [0, 0.5)");
  const s = sortAsc(samples);
  const k = Math.floor(s.length * trim);
  const kept = s.slice(k, s.length - k);
  return kept.reduce((acc, v) => acc + v, 0) / kept.length;
}
