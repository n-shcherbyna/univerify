import { describe, it, expect } from "vitest";
import { zksyncCostModel } from "../../src/cost-models/zksync.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const m: NormalizedMetrics = {
  chainId: 300,
  chainName: "zksyncSepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 131_463n,
  effectiveGasPrice: 50_000_000n,
  l1DataFee: 0n,
  calldataBytes: 68,
  blockNumber: 100n,
  txHash: "0xcc",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("zksyncCostModel", () => {
  it("exec = gasUsed × 0.05 gwei sequencer price", () => {
    const out = zksyncCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1n,
    });
    expect(out).toBe(131_463n * 50_000_000n);
  });

  it("l1Data is zero (bundled into gasUsed; not disentangled)", () => {
    const out = zksyncCostModel.l1Data(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 999_999n,
    });
    expect(out).toBe(0n);
  });
});
