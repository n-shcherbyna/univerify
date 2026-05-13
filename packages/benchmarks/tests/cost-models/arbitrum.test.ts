import { describe, it, expect } from "vitest";
import { arbitrumCostModel } from "../../src/cost-models/arbitrum.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const m: NormalizedMetrics = {
  chainId: 421614,
  chainName: "arbitrumSepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 55_000n,
  effectiveGasPrice: 100_000_000n,
  l1DataFee: 0n,
  l1GasUsed: 0n,
  calldataBytes: 1_000,
  blockNumber: 100n,
  txHash: "0xdd",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("arbitrumCostModel", () => {
  it("exec = gasUsed × 0.1 gwei sequencer price", () => {
    const out = arbitrumCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    expect(out).toBe(55_000n * 100_000_000n);
  });

  it("l1Data = calldataBytes × ARB_BLOB_GAS_PER_BYTE × blobBasefeeWei", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    // For ARB_BLOB_GAS_PER_BYTE = 1 and ratio 1.0:
    //   1000 bytes × 1 × 1e9 wei = 1e12 wei
    expect(arbitrumCostModel.l1Data(m, p)).toBe(1_000n * 1_000_000_000n);
  });

  it("l1Data is monotonic in calldataBytes", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    const small = arbitrumCostModel.l1Data(m, p);
    const big = arbitrumCostModel.l1Data({ ...m, calldataBytes: 2_000 }, p);
    expect(big).toBe(small * 2n);
  });

  it("l1Data is independent of basefee (only blob basefee matters)", () => {
    const a = arbitrumCostModel.l1Data(m, {
      basefeeWei: 1_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    const b = arbitrumCostModel.l1Data(m, {
      basefeeWei: 100_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    expect(a).toBe(b);
  });
});
