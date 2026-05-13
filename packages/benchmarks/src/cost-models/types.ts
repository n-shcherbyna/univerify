// packages/benchmarks/src/cost-models/types.ts
import type { NormalizedMetrics } from "../chains/types.js";

/**
 * Mainnet basefee + blob basefee at a chosen percentile (e.g. p10/p50/p90).
 * The export stage builds one PriceQuote per percentile per row.
 */
export type PriceQuote = {
  basefeeWei: bigint;
  blobBasefeeWei: bigint;
};

export interface CostModel {
  /** Execution cost on the chain's own gas market. */
  exec(m: NormalizedMetrics, p: PriceQuote): bigint;
  /** L1 data-posting cost projected to mainnet. Zero for L1 chains. */
  l1Data(m: NormalizedMetrics, p: PriceQuote): bigint;
}
