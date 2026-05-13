// packages/benchmarks/src/cost-models/arbitrum.ts
//
// Arbitrum Nitro (post-Cancun, April 2024). Batches are Brotli-compressed
// and posted to L1 as blobs. The per-byte cost charged by Arbitrum equals
// blob_basefee × ARB_BLOB_GAS_PER_BYTE per compressed byte. For pseudo-random
// Merkle hash data the compression ratio is ~1.0, so compressedBytes ≈
// calldataBytes.
//
// source: Arbitrum docs, "Gas and Fees" + L2BEAT post-Cancun L1 data cost
// fetched: 2026-05-13

import { L2_MAINNET_GAS_PRICE_WEI } from "../config.js";
import type { CostModel } from "./types.js";

const ARB_PRICE_WEI = L2_MAINNET_GAS_PRICE_WEI.arbitrumSepolia!;
const ARB_BLOB_GAS_PER_BYTE = 1n;
// Brotli compression ratio for the pseudo-random hash data published in
// Merkle-batch and revoke calldata is effectively 1.0; the constant is
// kept explicit for documentation rather than computed at runtime.

export const arbitrumCostModel: CostModel = {
  exec(m) {
    return BigInt(m.gasUsed) * ARB_PRICE_WEI;
  },
  l1Data(m, p) {
    return BigInt(m.calldataBytes) * ARB_BLOB_GAS_PER_BYTE * p.blobBasefeeWei;
  },
};
