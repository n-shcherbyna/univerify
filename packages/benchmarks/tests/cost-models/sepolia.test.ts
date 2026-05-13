import { describe, it, expect } from "vitest";
import { sepoliaCostModel } from "../../src/cost-models/sepolia.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const m: NormalizedMetrics = {
  chainId: 11155111,
  chainName: "sepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 55_000n,
  effectiveGasPrice: 30_000_000_000n,
  l1DataFee: 0n,
  calldataBytes: 68,
  blockNumber: 100n,
  txHash: "0xaa",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("sepoliaCostModel", () => {
  it("exec = gasUsed × basefee", () => {
    const out = sepoliaCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1n,
    });
    expect(out).toBe(55_000n * 30_000_000_000n);
  });

  it("l1Data is zero (no rollup data posting)", () => {
    const out = sepoliaCostModel.l1Data(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 999_999n,
    });
    expect(out).toBe(0n);
  });
});
