# Phase 2 — L2 Benchmarks: Design

**Date:** 2026-04-19
**Author:** Nazar Shcherbyna
**Context:** Master's thesis, Warsaw University of Technology. Phase 2 of the UniVerify thesis extension plan (Phase 1 — privacy — is complete).
**Status:** Approved for implementation.

## 1. Goal & Scope

Produce a reproducible dataset and a thesis chapter (LaTeX, Polish) comparing the cost, latency, and operational profile of running UniVerify's `DiplomaRegistry` on four Ethereum networks.

### 1.1 Chains under test

| Category | Chain (testnet) | Chain ID | Role |
|---|---|---|---|
| L1 baseline | Sepolia | 11155111 | reference |
| Optimistic rollup | Arbitrum Sepolia | 421614 | optimistic / Nitro |
| OP-stack | Base Sepolia | 84532 | OP-stack representative |
| zk-rollup | zkSync Sepolia *(Scroll Sepolia fallback)* | 300 / 534351 | zk family |

### 1.2 In scope

- `issueBatch(merkleRoot)` sweep over batch sizes {1, 10, 100, 1 000, 10 000} leaves.
- `revokeFromBatch(...)` single-transaction cost + inclusion latency.
- `statusWithProof(...)` RPC read-latency distribution.

### 1.3 Out of scope

- Admin writes (`addIssuer`, `addUniversity`, etc.).
- ZK-specific privacy costs (Phase 3).
- Mainnet execution (free testnets only; USD modelled from historical mainnet basefees).
- CI automation — runs are triggered manually.

### 1.4 Outputs (all committed)

1. **Raw results**: `benchmarks/results/<run-id>.json` — full receipts, timings, calldata bytes, L1-data-fee components.
2. **Processed data**: `docs/l2-benchmarks/data/*.csv`, `*.dat` — pgfplots- and `csvautotabular`-ready.
3. **Basefee history**: `benchmarks/price-history/<YYYY-MM-DD>.json` — 90-day mainnet basefee series used for USD cost modelling.
4. **Thesis chapter**: `docs/univerify-l2-benchmarks.tex` — Polish LaTeX document matching the style of `docs/univerify-gas-experiments.tex`.

### 1.5 Success criterion

A reviewer with the repo + testnet faucet ETH can regenerate every table and figure in the chapter from one command.

## 2. Architecture

Four decoupled stages, each rerunnable in isolation. Stages communicate only via committed files.

```
Stage 1: DEPLOY        → contracts/deployments/{chainId}.json
Stage 2: MEASURE       → benchmarks/results/<run-id>.json
Stage 3: PRICE         → benchmarks/price-history/<date>.json
Stage 4: EXPORT        → docs/l2-benchmarks/data/*.{csv,dat}
```

### 2.1 Stage 1 — Deploy

`forge script Deploy.s.sol` on each of four chains. Writes one deployment JSON per chain. Existing deployment files are reused — deploy only runs for chains missing a deployment.

### 2.2 Stage 2 — Measure

Per chain:

- `runIssueSweep(batchSizes=[1,10,100,1k,10k])` — one transaction per size (N=1 since gas is deterministic).
- `runRevokeBurst(N=30)` — 30 `revokeFromBatch` calls against a pre-seeded batch; captures inclusion-latency distribution.
- `runReadLatency(N=100)` — 100 `statusWithProof` calls; captures RPC response-time CDF.

Results from all chains are merged into a single `<run-id>.json`.

### 2.3 Stage 3 — Price

Fetches the last 90 days of Ethereum L1 basefee data from a public API (provisional: Etherscan's `gastracker` + `eth_feeHistory` fallback). Caches to `benchmarks/price-history/<YYYY-MM-DD>.json`. Idempotent — re-runs the same day reuse the cache.

From the raw series the exporter derives three scenarios:

- **p10** ("quiet L1")
- **p50** ("typical L1")
- **p90** ("congested L1")

### 2.4 Stage 4 — Export

Joins `results/<run-id>.json` × `price-history/<date>.json` and emits the CSV + `.dat` files the thesis consumes. By default pairs the newest results file with the newest price-history file; both can be overridden via `--results=<path>` and `--prices=<path>` for deterministic reruns. No live RPC, no network calls. The LaTeX doc reads only committed files.

### 2.5 Key design choices

- **Chain adapters abstract L1-data-fee quirks.** Each chain exposes rollup-specific fee components differently — Optimism/Base have `l1Fee` + `l1GasUsed` on the receipt; Arbitrum uses `NodeInterface.gasEstimateL1Component` or `gasUsedForL1`; zkSync uses `refundedGas` + its own tx struct. A narrow adapter interface (`submitTx`, `parseReceipt`) hides all of it behind a `NormalizedMetrics` output.
- **Stages are decoupled by file artifacts.** Re-export without re-measuring; re-measure one chain without touching others.
- **No live RPC at report time.** LaTeX only reads committed `.dat`/`.csv` files. Every run is frozen with a "measured on YYYY-MM-DD" footnote.

## 3. Components & Package Layout

### 3.1 New workspace package

```
packages/benchmarks/
  package.json                    # new workspace; depends on @univerify/sdk, @univerify/verifier-core
  tsconfig.json
  src/
    index.ts                      # CLI entry (args → stages)
    config.ts                     # chains[], batchSizes[], N values — single source of truth
    chains/
      types.ts                    # ChainAdapter interface, NormalizedMetrics type
      sepolia.ts                  # L1 adapter (no L1 data fee)
      arbitrumSepolia.ts
      baseSepolia.ts
      zksyncSepolia.ts
      index.ts                    # getAdapter(chainId)
    stages/
      deploy.ts
      measure.ts                  # orchestrates ops across chains
      price.ts
      export.ts
    ops/
      issueBatch.ts               # off-chain Merkle build + on-chain root submit
      revokeBatch.ts              # picks random leaf from a seeded batch, revokes
      readLatency.ts              # N timed statusWithProof calls
    util/
      merkle.ts                   # re-export from @univerify/verifier-core
      timing.ts                   # performance.now() + outlier trimming
      wallet.ts                   # funded testnet wallet (BENCH_PK env)
  tests/
    adapters.test.ts              # mock RPC; receipt fixture → expected metrics
    export.test.ts                # fixture results.json → expected CSV
  README.md                       # run instructions, faucet links, env vars
```

### 3.2 Data layout

```
benchmarks/
  results/
    <run-id>.json                 # committed
    <run-id>.partial.json         # mid-run state (for --resume)
  price-history/
    <YYYY-MM-DD>.json             # committed

docs/
  univerify-l2-benchmarks.tex     # Polish thesis chapter
  l2-benchmarks/
    data/
      table-issue-cost.csv
      table-issue-per-diploma.csv
      table-revoke-cost.csv
      table-read-latency.csv
      table-inclusion-latency.csv
      fig1-cost-per-diploma.dat
      fig2-gas-vs-l1data.dat
      fig3-read-latency-cdf.dat
      fig4-basefee-scenarios.dat
      meta.json                   # run-id, timestamps, price-source URL — \input{}-ed by .tex
    figures/                      # hand-built TikZ if any
```

### 3.3 Key interfaces

```ts
// packages/benchmarks/src/chains/types.ts

export type OpKind = 'issueBatch' | 'revokeFromBatch' | 'statusWithProof';

export type NormalizedMetrics = {
  chainId: number;
  op: OpKind;
  batchSize?: number;              // only for issueBatch
  gasUsed: bigint;
  effectiveGasPrice: bigint;       // wei
  l1DataFee: bigint;               // 0n on L1; rollup-specific on L2s
  l1GasUsed?: bigint;              // optional — not all chains expose
  calldataBytes: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  submittedAt: number;             // ms epoch, client-side performance.now() base
  includedAt: number;              // ms epoch
  inclusionLatencyMs: number;      // derived
};

export interface ChainAdapter {
  chainId: number;
  name: string;
  submitTx(call: TxRequest): Promise<TxResponse>;
  parseReceipt(receipt: TxReceipt, calldata: Hex, timing: Timing): NormalizedMetrics;
}
```

### 3.4 Command surface

```bash
npm -w @univerify/benchmarks run deploy                               # Stage 1
npm -w @univerify/benchmarks run measure                              # Stage 2 — all chains
npm -w @univerify/benchmarks run measure -- --chain=arbitrumSepolia   # single chain
npm -w @univerify/benchmarks run measure -- --resume=<run-id>         # resume partial
npm -w @univerify/benchmarks run price                                # Stage 3
npm -w @univerify/benchmarks run export                               # Stage 4
npm -w @univerify/benchmarks run all                                  # stages 2→3→4
npm -w @univerify/benchmarks run smoke                                # N=1 everything, one chain
```

## 4. Data Flow & Thesis Artifacts

Each table and figure is driven by exactly one `.csv` or `.dat` file. The exporter is the only place that joins results with prices — LaTeX never computes.

### 4.1 Tables (Polish headers)

| # | Table | Driven by |
|---|---|---|
| 1 | Koszt `issueBatch` według sieci i rozmiaru paczki | `table-issue-cost.csv` |
| 2 | Koszt na dyplom (amortyzacja paczki) | `table-issue-per-diploma.csv` |
| 3 | Koszt `revokeFromBatch` (pojedyncza transakcja) | `table-revoke-cost.csv` |
| 4 | Latencja odczytu `statusWithProof` — {p50, p95, p99, max} | `table-read-latency.csv` |
| 5 | Latencja inkluzji transakcji zapisu — {p50, p95} | `table-inclusion-latency.csv` |

### 4.2 Figures

| # | Figure | Driven by |
|---|---|---|
| 1 | log-log: koszt-na-dyplom vs rozmiar paczki, krzywa na sieć | `fig1-cost-per-diploma.dat` |
| 2 | stacked bar: gas vs L1-data-fee dla `issueBatch(1000)` | `fig2-gas-vs-l1data.dat` |
| 3 | CDF latencji odczytu, krzywa na sieć | `fig3-read-latency-cdf.dat` |
| 4 | Koszt `issueBatch(1000)` przy scenariuszach basefee p10/p50/p90 | `fig4-basefee-scenarios.dat` |

### 4.3 Reproducibility anchor

`meta.json` (also in `docs/l2-benchmarks/data/`) carries:

- `runId` — hash of the results file used
- `measuredAt` — ISO timestamp
- `priceSource` — URL of the basefee API
- `priceWindow` — ISO range of the 90-day window
- `chainCommitSha` — repo commit at measurement time

The LaTeX doc `\input{}`s `meta.json`-derived values so the "measured on" footnote refreshes automatically.

## 5. Error Handling, Edge Cases, Testing

### 5.1 Failure modes

| Mode | Handling |
|---|---|
| Wallet underfunded | Pre-flight balance check per chain (≥ estimated-cost × 1.5). Fail fast with faucet URL. |
| RPC flake | 3 retries with exponential backoff. After 3 failures, save `<run-id>.partial.json` and abort. Resume via `--resume=<run-id>`. |
| Sequencer reorg / missing receipt | 5-minute hard timeout on `waitForReceipt`. Tx logged with status `"timeout"`, excluded from aggregates, kept in raw JSON. |
| zkSync tooling gaps | Swap `getAdapter()` entry to Scroll Sepolia. Called out in thesis methodology. |
| Gas-price API down | Stage 3 is idempotent; Stage 4 refuses to export if no cached price file. Clear error message. |

### 5.2 Edge cases

- **batchId allocation** — orchestrator reads next free `batchId` from contract; no collisions.
- **revoke needs a seeded batch** — revoke-burst first issues a 40-leaf seed batch (tagged `seed`, excluded from the main `issueBatch` aggregate), then runs 30 revokes against it.
- **clock skew** — inclusion latency is measured with `performance.now()` locally, not block timestamps, to avoid sequencer-clock noise. Documented in thesis methodology.

### 5.3 Testing

- **Unit — adapters**: each `parseReceipt` has a committed receipt fixture; test asserts `NormalizedMetrics` fields. Catches regressions when a chain changes its fee model.
- **Unit — exporter**: fixture `results.json` + `price-history.json` → snapshot-compare emitted CSVs and `.dat` files. Runs in existing `vitest`.
- **Integration (manual)**: `npm -w @univerify/benchmarks run smoke` — `issueBatch(1)` + one revoke + N=3 reads on one chain (default Sepolia). ~2 min. Used before a full benchmark run.
- **No CI integration test** — full sweep needs shared testnet funds and is inherently flaky. Smoke is sufficient.

## 6. Rollback / Exit Plan

If zkSync tooling proves unworkable after implementing the adapter, fall back to Scroll Sepolia. If an L2 chain is unreachable during the final measurement run, document the gap in the thesis and ship with three chains instead of four — the chapter's narrative is robust to one missing data point.

Phase 2 does not modify product code (`contracts/`, `apps/`, `packages/sdk`, `packages/verifier-core`, `packages/verifier-cli`). If the benchmark work has to be abandoned, deleting `packages/benchmarks/`, `benchmarks/`, and `docs/l2-benchmarks/` fully reverts the repo.
