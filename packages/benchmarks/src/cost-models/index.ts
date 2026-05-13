// packages/benchmarks/src/cost-models/index.ts
import type { ChainKey } from "../config.js";
import type { NormalizedMetrics } from "../chains/types.js";
import { arbitrumCostModel } from "./arbitrum.js";
import { baseCostModel } from "./base.js";
import { sepoliaCostModel } from "./sepolia.js";
import type { CostModel, PriceQuote } from "./types.js";
import { zksyncCostModel } from "./zksync.js";

export type { CostModel, PriceQuote } from "./types.js";

const REGISTRY: Record<ChainKey, CostModel> = {
  sepolia: sepoliaCostModel,
  baseSepolia: baseCostModel,
  arbitrumSepolia: arbitrumCostModel,
  zksyncSepolia: zksyncCostModel,
};

export function getCostModel(chainName: string): CostModel {
  switch (chainName as ChainKey) {
    case "sepolia":
    case "baseSepolia":
    case "arbitrumSepolia":
    case "zksyncSepolia":
      return REGISTRY[chainName as ChainKey];
    default: {
      const _exhaustive: never = chainName as never;
      throw new Error(`unknown chainName: ${chainName} (${_exhaustive})`);
    }
  }
}

export function totalCostWei(m: NormalizedMetrics, p: PriceQuote): bigint {
  const model = getCostModel(m.chainName);
  return model.exec(m, p) + model.l1Data(m, p);
}
