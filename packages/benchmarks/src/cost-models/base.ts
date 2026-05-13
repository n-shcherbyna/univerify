// packages/benchmarks/src/cost-models/base.ts
//
// Base (OP-stack post-Ecotone). The L2's L1FeeVault computes the L1 data
// fee per tx as:
//   rollupDataGas = 16 × calldataBytes   (conservative: treat all bytes as
//                                          non-zero @ 16 gas/byte)
//   l1FeeWei = rollupDataGas
//            × (16 · baseFeeScalar · l1BaseFee + blobBaseFeeScalar · l1BlobBaseFee)
//            ÷ 16_000_000
//
// source: Base L1 SystemConfig 0x73a79Fab69143498Ed3712e519A88a918e1f4072
// fetched: 2026-05-13 (L1 block 25087416)

import { L2_MAINNET_GAS_PRICE_WEI } from "../config.js";
import type { CostModel } from "./types.js";

const BASE_PRICE_WEI = L2_MAINNET_GAS_PRICE_WEI.baseSepolia!;
const BASE_BASE_FEE_SCALAR = 2269n;
const BASE_BLOB_BASE_FEE_SCALAR = 1055762n;
const BASE_DENOMINATOR = 16_000_000n;

export const baseCostModel: CostModel = {
  exec(m) {
    return BigInt(m.gasUsed) * BASE_PRICE_WEI;
  },
  l1Data(m, p) {
    const rollupDataGas = 16n * BigInt(m.calldataBytes);
    const numerator =
      16n * BASE_BASE_FEE_SCALAR * p.basefeeWei +
      BASE_BLOB_BASE_FEE_SCALAR * p.blobBasefeeWei;
    return (rollupDataGas * numerator) / BASE_DENOMINATOR;
  },
};
