# @univerify/benchmarks

Layer-2 cost and latency benchmarks for the UniVerify on-chain registry. Produces the tables and figures consumed by the Phase 2 thesis chapter at `docs/univerify-l2-benchmarks.tex`.

## Pipeline

```
deploy → measure → price → export → aggregate (when --runs > 1)
```

- **deploy** — Foundry script broadcasts `DiplomaRegistry` to each testnet. Skips chains already deployed (per `contracts/deployments/<chainId>.json`).
- **measure** — issues `issueBatch` across sizes `{1, 10, 100, 1k, 10k}`, runs a 30-tx randomized revoke burst, samples 100 read-latency points.
- **price** — fetches 90-day basefee + blob basefee history for the L1 from a mainnet RPC.
- **export** — joins measured metrics with per-rollup cost models (`src/cost-models/`) and price percentiles to produce CSV tables and gnuplot `.dat` figures in `docs/l2-benchmarks/data/`.
- **aggregate** (Phase C) — combines results from `--runs=N` independent runs into final tables with σ columns.

## Reproduction

```bash
# 1. Configure .env (see "Environment" below)
cp .env.example .env  # or edit your existing .env

# 2. Fund the bench wallet on every chain (Sepolia + Arbitrum Sepolia + Base Sepolia + zkSync Sepolia)

# 3. From the repo root:
npm run benchmarks:all              # 1 run, all chains
npm run benchmarks:all -- --runs=3  # 3 runs (Phase C aggregation)
```

Output goes to `docs/l2-benchmarks/data/`. Every artifact is paired with `meta.json` recording the `runId`, `measuredAt`, ETH/USD snapshot, random seed, RPC provider/region, and run count.

## Environment

| Var | Purpose |
|-----|---------|
| `BENCH_PK` | 0x-prefixed 32-byte private key of a wallet funded on all four testnets. **Rotate before publishing the repo.** |
| `RPC_SEPOLIA` | Sepolia RPC URL |
| `RPC_ARBITRUM_SEPOLIA` | Arbitrum Sepolia RPC URL |
| `RPC_BASE_SEPOLIA` | Base Sepolia RPC URL |
| `RPC_ZKSYNC_SEPOLIA` | zkSync Sepolia RPC URL |
| `RPC_MAINNET` | Ethereum mainnet RPC URL (for the `price` stage) |
| `ETH_USD_SNAPSHOT` | (Optional) override ETH/USD price for export. Defaults to the value documented in `src/stages/export.ts`. |
| `BENCH_RANDOM_SEED` | (Optional, Phase C) seed for randomized revoke. Defaults to `"univerify-phase-2"`. |

**Single-POP recommendation:** For defensible read-latency comparisons across chains, all four `RPC_*` variables should point at the **same provider and region** (e.g., Alchemy `us-east-1`). The thesis Limitations section discloses this.

## Reproducibility

Every export run writes `docs/l2-benchmarks/data/meta.json` with:

```json
{
  "runId": "20260517T101530-a3f1",
  "measuredAt": "2026-05-17T10:15:30.000Z",
  "priceSource": "benchmarks/price-history/<id>.json",
  "ethUsd": 3500,
  "ethUsdSnapshotDate": "2026-05-13",
  "randomSeed": "univerify-phase-2",
  "runs": 3,
  "chains": ["sepolia", "arbitrumSepolia", "baseSepolia", "zksyncSepolia"]
}
```

This makes any committed table traceable to a specific input.

## Security

- `BENCH_PK` is read from the environment in `src/stages/deploy.ts` via `execFileSync` and never passed on the command line — it does not appear in `ps aux` or shell history.
- Treat any `BENCH_PK` that has been pasted into a chat or stored in plaintext as **compromised**. Rotate before any post-thesis reuse and never reuse a mainnet key here.

## Limitations of the measurement

See `docs/univerify-l2-benchmarks.tex` → `Dyskusja → Ograniczenia pomiaru` for the authoritative list. In short:
- Arbitrum L1-data cost assumes Brotli compression ratio = 1.0 (pseudo-random Merkle data).
- zkSync `gasUsed` is not commensurable with EVM gas; compare USD/ETH only across rollup families.
- Inclusion latency is poll-bound at viem's ~4 s interval — upper bound, not block-inclusion.
- Snapshot dates for Base SystemConfig scalars (L1 block 25087416) and ETH/USD apply.
