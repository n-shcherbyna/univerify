// packages/benchmarks/src/stages/nextBatchId.ts
import type { Hex } from "viem";

const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export type BatchReader = (id: bigint) => Promise<Hex>;

/**
 * Find the smallest `batchId` whose root is zero (i.e. the next unused id).
 *
 * Strategy: doubling-then-binary-search.
 *   1. Find an upper bound by doubling from 1 until the reader returns zero.
 *   2. Binary-search the half-open interval [lower, upper).
 *
 * Total reads: O(log n) for n actual batches. The reader is awaited
 * sequentially because RPC providers rate-limit per-key; parallelism would
 * make this slower in practice.
 */
export async function findNextBatchId(read: BatchReader): Promise<bigint> {
  if ((await read(0n)) === ZERO_BYTES32) return 0n;

  let upper = 1n;
  while ((await read(upper)) !== ZERO_BYTES32) {
    upper *= 2n;
  }
  let lower = upper / 2n;

  // Invariant: read(lower) is non-zero, read(upper) is zero. Binary search.
  while (upper - lower > 1n) {
    const mid = (lower + upper) / 2n;
    if ((await read(mid)) === ZERO_BYTES32) {
      upper = mid;
    } else {
      lower = mid;
    }
  }
  return upper;
}
