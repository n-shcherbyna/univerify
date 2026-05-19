import { describe, it, expect } from "vitest";
import { findNextBatchId } from "../../src/stages/nextBatchId.js";

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
const NONZERO = "0xabcdef0000000000000000000000000000000000000000000000000000000000";

function makeReader(occupied: bigint): (id: bigint) => Promise<`0x${string}`> {
  return async (id) => (id < occupied ? (NONZERO as `0x${string}`) : (ZERO as `0x${string}`));
}

describe("findNextBatchId", () => {
  it("returns 0 when no batches exist", async () => {
    expect(await findNextBatchId(makeReader(0n))).toBe(0n);
  });

  it("returns 1 when only batch 0 exists", async () => {
    expect(await findNextBatchId(makeReader(1n))).toBe(1n);
  });

  it("returns 17 when batches 0..16 exist", async () => {
    expect(await findNextBatchId(makeReader(17n))).toBe(17n);
  });

  it("returns 1024 when batches 0..1023 exist (exact power of two)", async () => {
    expect(await findNextBatchId(makeReader(1024n))).toBe(1024n);
  });

  it("uses O(log n) reads", async () => {
    let calls = 0;
    const reader = async (id: bigint): Promise<`0x${string}`> => {
      calls++;
      return id < 1_000_000n ? (NONZERO as `0x${string}`) : (ZERO as `0x${string}`);
    };
    const result = await findNextBatchId(reader);
    expect(result).toBe(1_000_000n);
    // Doubling-then-binary-search is bounded by ~2*ceil(log2(n)). Allow slack.
    expect(calls).toBeLessThan(60);
  });
});
