import { describe, it, expect } from "vitest";
import { getCostModel, totalCostWei } from "../../src/cost-models/index.js";
import { baseCostModel } from "../../src/cost-models/base.js";
import { arbitrumCostModel } from "../../src/cost-models/arbitrum.js";
import { sepoliaCostModel } from "../../src/cost-models/sepolia.js";
import { zksyncCostModel } from "../../src/cost-models/zksync.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const sepoliaM: NormalizedMetrics = {
  chainId: 11155111, chainName: "sepolia", op: "issueBatch", batchSize: 1, tag: "main",
  gasUsed: 55_000n, effectiveGasPrice: 30_000_000_000n, l1DataFee: 0n,
  calldataBytes: 68, blockNumber: 100n, txHash: "0xaa",
  submittedAt: 0, includedAt: 100, inclusionLatencyMs: 100,
};

describe("getCostModel", () => {
  it("dispatches by chainName to the right model", () => {
    expect(getCostModel("sepolia")).toBe(sepoliaCostModel);
    expect(getCostModel("baseSepolia")).toBe(baseCostModel);
    expect(getCostModel("arbitrumSepolia")).toBe(arbitrumCostModel);
    expect(getCostModel("zksyncSepolia")).toBe(zksyncCostModel);
  });

  it("throws on unknown chainName", () => {
    expect(() => getCostModel("unknown")).toThrow(/unknown chain/i);
  });
});

describe("totalCostWei", () => {
  it("returns exec + l1Data for a sepolia metric", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1n };
    expect(totalCostWei(sepoliaM, p)).toBe(55_000n * 30_000_000_000n);
  });
});
