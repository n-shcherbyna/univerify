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

/**
 * Latency-only repetitions per issueBatch size. Each repetition consumes a
 * fresh batchId. N>=30 lets us report p50/p95/σ instead of a single sample.
 * Gas is deterministic per (size, code) so it's reported once; only timing
 * is sampled multiple times.
 */
export const ISSUE_LATENCY_REPS = 30;

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
 * These values are conservative upper bounds chosen above current snapshot
 * to absorb typical congestion swings; they are set by each chain's
 * sequencer and do not track L1 basefee. A real run can override per
 * scenario; the thesis Limitations section discloses the snapshot.
 *
 * Live snapshots taken 2026-05-13 via `eth_gasPrice` on each mainnet RPC:
 *   arb1.arbitrum.io/rpc:     20_000_000  wei (0.02   gwei)
 *   mainnet.base.org:          6_000_000  wei (0.006  gwei)
 *   mainnet.era.zksync.io:    45_250_000  wei (0.0453 gwei)
 *
 * Conservative values used here (round numbers above the snapshot):
 *   arbitrumSepolia → 100_000_000 wei (0.1   gwei) — 5× live snapshot
 *   baseSepolia     →   5_000_000 wei (0.005 gwei) — ~live snapshot
 *   zksyncSepolia   →  50_000_000 wei (0.05  gwei) — ~live snapshot
 *
 * Sources: L2BEAT cost panels (https://l2beat.com/scaling/projects/{arbitrum,base,zksync-era})
 * cross-checked against live eth_gasPrice on the snapshot date.
 */
export const L2_MAINNET_GAS_PRICE_WEI: Partial<Record<ChainKey, bigint>> = {
  arbitrumSepolia: 100_000_000n,
  baseSepolia: 5_000_000n,
  zksyncSepolia: 50_000_000n,
};

/**
 * Seed for randomized revoke leaf selection. Default is the literal
 * "univerify-phase-2" so a fresh `git clone` reproduces the committed run;
 * override via `BENCH_RANDOM_SEED` for a perturbation study.
 */
export const BENCH_RANDOM_SEED = process.env.BENCH_RANDOM_SEED ?? "univerify-phase-2";

/** Faucet URLs shown to the user on underfunded-wallet errors. */
export const FAUCETS: Record<ChainKey, string> = {
  sepolia: "https://sepoliafaucet.com/",
  arbitrumSepolia: "https://faucet.arbitrum.io/",
  baseSepolia: "https://faucet.quicknode.com/base/sepolia",
  zksyncSepolia: "https://docs.zksync.io/build/tooling/network-faucets",
};
