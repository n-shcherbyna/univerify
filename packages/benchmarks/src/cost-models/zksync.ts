// packages/benchmarks/src/cost-models/zksync.ts
//
// zkSync Era's reported gasUsed bundles execution + pubdata posting + proof
// + AA-bootloader overhead in a single unit that is not directly comparable
// to EVM gas. We project to mainnet using the sequencer price snapshot in
// config.ts and do not attempt to disentangle the L1 component (it is
// already inside gasUsed). See thesis Limitations section for the caveat.

import { L2_MAINNET_GAS_PRICE_WEI } from "../config.js";
import type { CostModel } from "./types.js";

const ZKSYNC_PRICE_WEI = L2_MAINNET_GAS_PRICE_WEI.zksyncSepolia!;

export const zksyncCostModel: CostModel = {
  exec(m) {
    return BigInt(m.gasUsed) * ZKSYNC_PRICE_WEI;
  },
  l1Data() {
    return 0n;
  },
};
