// packages/benchmarks/src/cost-models/arbitrum.ts
//
// Arbitrum Nitro (post-Cancun, April 2024). Batches are Brotli-compressed
// and posted to L1 as EIP-4844 blobs. A blob is 131_072 bytes and costs
// 131_072 × blob_basefee wei (1 blob_gas per byte). The effective per-
// calldata-byte L1 cost is therefore:
//
//   l1FeeWei = compressedBytes × blob_basefee
//            ≈ (calldataBytes × compressionRatio) × blob_basefee
//
// For the pseudo-random Merkle hash data published in this project's
// issueBatch / revoke calldata, Brotli's compression ratio is empirically
// ~1.0 (random bytes are incompressible), so we model compressedBytes ≈
// calldataBytes. This is conservative: real payloads with structured data
// would compress further and pay LESS L1 cost than this model predicts.
//
// LIMITATION (thesis Phase 2 writeup caveat): The 1.0 compression ratio
// applies only to this project's Merkle-root + revocation calldata. Apps
// with structured calldata would see ratios of 0.3–0.6, making this an
// upper bound, not an average. See thesis Limitations section.
//
// source:
//   - Arbitrum docs https://docs.arbitrum.io/build-decentralized-apps/how-to-estimate-gas
//   - EIP-4844 blob layout (131_072 bytes/blob, 1 blob_gas/byte)
//   - L2BEAT scaling/arbitrum cost panel
// fetched: 2026-05-13

import { L2_MAINNET_GAS_PRICE_WEI } from "../config.js";
import type { CostModel } from "./types.js";

const ARB_PRICE_WEI = L2_MAINNET_GAS_PRICE_WEI.arbitrumSepolia!;

// Effective blob-gas charged per calldata byte under the project-specific
// compression assumption above (1 blob_gas/byte × 1.0 compression ratio).
// NOT a published protocol constant — derived for this project's workload.
const ARB_BLOB_GAS_PER_BYTE = 1n;

export const arbitrumCostModel: CostModel = {
  exec(m) {
    return BigInt(m.gasUsed) * ARB_PRICE_WEI;
  },
  l1Data(m, p) {
    return BigInt(m.calldataBytes) * ARB_BLOB_GAS_PER_BYTE * p.blobBasefeeWei;
  },
};
