// packages/benchmarks/src/util/timing.ts

/**
 * Clock-source policy for this package:
 *
 *   - `performance.now()` (this module) — for ALL latency measurements
 *     (`submittedAt`, `includedAt`, RPC read timings). Monotonic; safe to diff;
 *     NOT comparable to wall-clock or `Date.now()`.
 *
 *   - `Date.now()` / `new Date()` — reserved for externally-meaningful
 *     timestamps that are stored to disk or reported to the user (e.g.
 *     `RunResults.measuredAt`, `ReadLatencySample.sampledAt`). These are
 *     wall-clock and may jump under NTP adjustment; never subtract two of
 *     them to measure an interval.
 *
 * When in doubt: a duration uses `performance.now()`; a timestamp uses
 * `Date.now()`.
 */
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
  // Nearest-rank, zero-indexed: index = ceil(p * n) - 1, clamped to [0, n-1].
  const idx = Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length) - 1));
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
