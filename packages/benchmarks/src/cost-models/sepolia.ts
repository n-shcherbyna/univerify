// packages/benchmarks/src/cost-models/sepolia.ts
//
// Sepolia is an L1 testnet; we project it to Ethereum mainnet by pricing
// execution gas at the mainnet basefee at the chosen percentile. There is
// no rollup L1-data component.

import type { CostModel } from "./types.js";

export const sepoliaCostModel: CostModel = {
  exec(m, p) {
    return BigInt(m.gasUsed) * p.basefeeWei;
  },
  l1Data() {
    return 0n;
  },
};
