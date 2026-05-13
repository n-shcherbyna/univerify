import { describe, it, expect } from "vitest";
import { baseCostModel } from "../../src/cost-models/base.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const BASE_BASE_FEE_SCALAR_VALUE = 2269n;
const BASE_BLOB_BASE_FEE_SCALAR_VALUE = 1055762n;

const m: NormalizedMetrics = {
  chainId: 84532,
  chainName: "baseSepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 55_000n,
  effectiveGasPrice: 100_000n,
  l1DataFee: 1_500_000_000_000n,
  l1GasUsed: 10_000n,
  calldataBytes: 1_000,
  blockNumber: 100n,
  txHash: "0xbb",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("baseCostModel", () => {
  it("exec = gasUsed × 0.005 gwei sequencer price", () => {
    const out = baseCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    expect(out).toBe(55_000n * 5_000_000n);
  });

  it("l1Data follows the Ecotone formula and is monotonic in calldataBytes", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    const small = baseCostModel.l1Data(m, p);
    const big = baseCostModel.l1Data({ ...m, calldataBytes: 2_000 }, p);
    expect(big).toBe(small * 2n);
    expect(small).toBeGreaterThan(0n);
  });

  it("l1Data matches a hand-calculated value", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    const rollupDataGas = 16n * BigInt(m.calldataBytes);
    const numerator =
      16n * BASE_BASE_FEE_SCALAR_VALUE * p.basefeeWei +
      BASE_BLOB_BASE_FEE_SCALAR_VALUE * p.blobBasefeeWei;
    const expected = (rollupDataGas * numerator) / 16_000_000n;
    expect(baseCostModel.l1Data(m, p)).toBe(expected);
  });
});
