// packages/benchmarks/src/config.ts
export type ChainKey = "sepolia" | "arbitrumSepolia" | "baseSepolia" | "zksyncSepolia";

export const CHAIN_IDS: Record<ChainKey, number> = {
  sepolia: 11155111,
  arbitrumSepolia: 421614,
  baseSepolia: 84532,
  zksyncSepolia: 300,
};

export const CHAIN_KEYS: ChainKey[] = [
  "sepolia",
  "arbitrumSepolia",
  "baseSepolia",
  "zksyncSepolia",
];

/** Batch sizes swept for issueBatch. */
export const BATCH_SIZES = [1, 10, 100, 1_000, 10_000] as const;

/** Sample size for revokeFromBatch inclusion-latency distribution. */
export const REVOKE_N = 30;

/** Sample size for statusWithProof read-latency distribution. */
export const READ_N = 100;

/** Seed-batch size used to pre-populate leaves for revokeBatch (must be ≥ REVOKE_N + 10 slack). */
export const SEED_BATCH_SIZE = 40;

/** Hard timeout for `waitForReceipt` (ms). zkSync tolerant. */
export const RECEIPT_TIMEOUT_MS = 5 * 60 * 1000;

/** Retries for RPC-level transient failures. */
export const RPC_RETRIES = 3;

/** RPC URL env-var names per chain. */
export const RPC_ENV: Record<ChainKey, string> = {
  sepolia: "RPC_SEPOLIA",
  arbitrumSepolia: "RPC_ARBITRUM_SEPOLIA",
  baseSepolia: "RPC_BASE_SEPOLIA",
  zksyncSepolia: "RPC_ZKSYNC_SEPOLIA",
};

/**
 * Typical mainnet sequencer gas price per L2, in wei per gas. Used by the
 * export stage to project measured L2 testnet gas usage to mainnet cost.
 * L1 chains use the L1 mainnet basefee (from price history) directly.
 *
 * Values are conservative round numbers for an L2 in typical (non-congested)
 * conditions; they are set by the sequencer and do not track L1 basefee.
 *   Arbitrum One — ~0.01–0.1 gwei observed; 0.1 gwei used here.
 *   Base mainnet — ~0.001–0.01 gwei observed; 0.005 gwei used here.
 *   zkSync Era  — ~0.025–0.1 gwei observed; 0.05 gwei used here.
 */
export const L2_MAINNET_GAS_PRICE_WEI: Partial<Record<ChainKey, bigint>> = {
  arbitrumSepolia: 100_000_000n,
  baseSepolia: 5_000_000n,
  zksyncSepolia: 50_000_000n,
};

/**
 * Per-L2 estimate of L1 gas per calldata byte after rollup compression.
 * Used by the export stage as a fallback when the chain's testnet reports
 * l1GasUsed = 0 by policy (Arbitrum Sepolia waives the L1 data fee; mainnet
 * Arbitrum One still charges it). Chains absent from this map use the
 * measured l1GasUsed directly.
 *
 * Arbitrum One: typical 10 L1 gas/byte effective after compression for
 * mostly-nonzero calldata (raw 16 gas/byte × ~0.6 compression).
 */
export const L1_GAS_PER_CALLDATA_BYTE_ESTIMATE: Partial<Record<ChainKey, number>> = {
  arbitrumSepolia: 10,
};

/** Faucet URLs shown to the user on underfunded-wallet errors. */
export const FAUCETS: Record<ChainKey, string> = {
  sepolia: "https://sepoliafaucet.com/",
  arbitrumSepolia: "https://faucet.arbitrum.io/",
  baseSepolia: "https://faucet.quicknode.com/base/sepolia",
  zksyncSepolia: "https://docs.zksync.io/build/tooling/network-faucets",
};
