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

/** Faucet URLs shown to the user on underfunded-wallet errors. */
export const FAUCETS: Record<ChainKey, string> = {
  sepolia: "https://sepoliafaucet.com/",
  arbitrumSepolia: "https://faucet.arbitrum.io/",
  baseSepolia: "https://faucet.quicknode.com/base/sepolia",
  zksyncSepolia: "https://docs.zksync.io/build/tooling/network-faucets",
};
