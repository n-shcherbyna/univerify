# @univerify/benchmarks

L2 benchmark pipeline for UniVerify. Measures `DiplomaRegistry` gas,
L1 data fee, and RPC read latency across Sepolia (L1 baseline),
Arbitrum Sepolia, Base Sepolia, and zkSync Sepolia.

See [spec](../../docs/superpowers/specs/2026-04-19-l2-benchmarks-design.md)
for the design.

## Setup

1. **Fund a single benchmark wallet** on all four testnets. Export its
   private key as `BENCH_PK` (0x-prefixed, 32 bytes):

   ```bash
   export BENCH_PK=0x...
   ```

2. **Export RPC URLs** for each chain and mainnet (for historical basefees):

   ```bash
   export RPC_MAINNET=https://eth.llamarpc.com
   export RPC_SEPOLIA=https://rpc.sepolia.org
   export RPC_ARBITRUM_SEPOLIA=https://sepolia-rollup.arbitrum.io/rpc
   export RPC_BASE_SEPOLIA=https://sepolia.base.org
   export RPC_ZKSYNC_SEPOLIA=https://sepolia.era.zksync.dev
   ```

   Faucets:
   - Sepolia — https://sepoliafaucet.com/
   - Arbitrum Sepolia — https://faucet.arbitrum.io/
   - Base Sepolia — https://faucet.quicknode.com/base/sepolia
   - zkSync Sepolia — https://docs.zksync.io/build/tooling/network-faucets

## Usage

```bash
# Stage 1: deploy DiplomaRegistry on any chain missing a deployment file
npm run benchmarks:deploy

# Stage 2: measure (all chains)
npm run benchmarks:measure

# Stage 2: measure just one chain
npm -w @univerify/benchmarks run measure -- --chain=baseSepolia

# Resume a partial run
npm -w @univerify/benchmarks run measure -- --resume=20260419T120000-beef

# Stage 3: fetch 90-day mainnet basefee history (idempotent per day)
npm run benchmarks:price

# Stage 4: export CSV + .dat files to docs/l2-benchmarks/data/
npm run benchmarks:export

# Stages 2 → 3 → 4 in one command
npm run benchmarks:all

# Smoke test (Sepolia only, ~2 min)
npm run benchmarks:smoke
```

## Data layout

- `benchmarks/results/<run-id>.json` — raw per-transaction records (committed).
- `benchmarks/price-history/<YYYY-MM-DD>.json` — mainnet basefee samples (committed).
- `docs/l2-benchmarks/data/` — exporter output (committed).

## Rebuilding the LaTeX chapter

```bash
cd docs && pdflatex univerify-l2-benchmarks.tex
```

The `.tex` file reads only files under `l2-benchmarks/data/` — no live RPC.

## Troubleshooting

- **"BENCH_PK is not set"** — export the env var; it must start with `0x` and be 66 chars.
- **"wallet has ... wei (< 0.001 ETH)"** — faucet URL is printed in the error.
- **zkSync tooling errors** — fall back to Scroll Sepolia by replacing
  `src/chains/zksyncSepolia.ts` (chain id 534351, different RPC).
