# Phase 2 — Professional Finishing Design

**Date:** 2026-05-17
**Status:** Approved, ready for implementation plan
**Predecessors:** [2026-04-19 L2 benchmarks design](2026-04-19-l2-benchmarks-design.md), [2026-05-13 EIP-4844 blob basefee design](2026-05-13-eip-4844-blob-basefee-design.md)

## Goal

Close Phase 2 in a state that is defensible at the master's thesis defense, with a clean, reproducible scaffolding that Phase 3 (privacy gas benchmarks) can safely reuse.

## Success criteria

All of the following must hold before Phase 2 is considered finished:

1. `npm run benchmarks:all` reproduces the entire `docs/l2-benchmarks/data/` directory from a clean clone, given a populated `.env`.
2. A CI job regenerates the tables and fails if they drift from the committed source.
3. All measurements are produced from N≥30 samples per latency op, with σ reported, across 3 independent runs, through a single RPC POP, with randomized revoke leaf selection.
4. No private key appears in process argv; transaction submission survives mempool drops via nonce manager with gas bump; partial files are written atomically.
5. `docs/univerify-l2-benchmarks.tex` → `Dyskusja → Ograniczenia pomiaru` covers every remaining caveat (post-Phase-C) with justified prose.
6. All test suites green (existing 164 tests plus new tests for nonce manager, atomic write, exhaustiveness check, randomized revoke).

## Scope decisions

**Included:**
- Reproducibility scaffolding (orchestrator, CI drift check, README, CHANGELOG)
- Code robustness and opsec fixes that affect Phase 3 reuse or are visible on GitHub
- Full measurement re-run that *eliminates* four caveats instead of describing them: RPC geography (#4), N=1 (#5), deterministic revoke (#6), no cross-run variance (#7)
- Thesis-prose expansion for the remaining six caveats

**Explicitly out-of-scope (will not be addressed in Phase 2 finishing):**
- Adding `latestBatchId(address)` view to `DiplomaRegistry.sol` — solve client-side via binary search; avoids re-deployment
- Rewriting inclusion-latency to event-based — caveat #3 stays in prose; not blocking
- Mainnet measurements — Phase 2 is testnet by design; mainnet would be a separate project
- CI gas-snapshot tests for Solidity — out-of-scope for Phase 2 finishing

## Phase A — Reproducibility scaffolding

Estimated: 1 day. Must complete first because B and C depend on the CI drift check existing.

**Components:**

- `packages/benchmarks/src/cli/all.ts` — orchestrator invoking `deploy → measure → price → export` per chain, with fail-fast and resume semantics. CLI flags: `--chain=<key>`, `--op=<issueBatch|revokeBatch>`, `--runs=<n>`, `--resume`.
- `packages/benchmarks/README.md` — pipeline overview, `.env` requirements, testnet ETH requirements per chain, single-command reproduction instructions, troubleshooting section.
- CI workflow (e.g., `.github/workflows/benchmarks-drift.yml`) — runs only the `price` and `export` stages against the committed `packages/benchmarks/results/` JSON (no RPC calls in CI), diffs the regenerated `docs/l2-benchmarks/data/*` against the committed version, fails on drift. The expensive `deploy` and `measure` stages stay local-only.
- `CHANGELOG.md` root entry covering the EIP-4844 cost models, Phase 2 final scope, and reproducibility scaffolding.

**Interface contract:** From a fresh `git clone` with `.env` populated, `npm install && npm run build && npm run benchmarks:all` produces byte-identical `docs/l2-benchmarks/data/*.csv` and `*.dat` files modulo the timestamp in `meta.json`.

## Phase B — Code robustness & opsec

Estimated: 2 days. Each sub-component is its own commit/PR.

### B.1 Opsec

- `packages/benchmarks/src/stages/deploy.ts:24` — `execSync` → `execFileSync` with arg array; pass `BENCH_PK` via `env`, never argv. No key in `ps aux` or shell history.
- Document `BENCH_PK` rotation requirement in `packages/benchmarks/README.md` security section.

### B.2 Nonce / replacement handling

- New `packages/benchmarks/src/util/nonceManager.ts`: `getNextNonce(account, client)` with local counter, retry with 1.25× gas bump if `waitForTransactionReceipt` exceeds 90 s, max 3 retries.
- Integration in `ops/issueBatch.ts` and `ops/revokeBatch.ts`.
- Test: mock viem client with simulated dropped tx → assert retry path executes and final receipt is returned.

### B.3 Atomic partial-file write

- `stages/measure.ts:129` — write to `${partialPath}.tmp`, then `fs.renameSync` to final path.
- SIGINT handler that flushes any in-flight write before exit.

### B.4 Resume per-(chain, op, batchSize)

- New partial-file schema: `{ [chainName]: { [op]: { [batchSize]: { completed: Sample[], pending: number[] } } } }`.
- Migration: detect old format on first open, convert, log a warning.

### B.5 `nextBatchId` binary search

- `stages/measure.ts:43-57` — replace O(n) scan with binary search using existing `getBatch(issuer, id)` view: find largest `id` where `getBatch` returns non-zero root, in O(log n) RPC calls.
- Wrap each RPC call in a small retry helper (3 attempts, exponential backoff) so transient provider errors don't kill the run.

### B.6 Correctness

- `stages/export.ts` — replace `chainName as ChainKey` cast with `switch` over chain key with `default: const _: never = m.chainName; throw new Error(\`unknown chain: ${m.chainName}\`)` for exhaustiveness.
- `util/wallet.ts:11` — extend validation to `^0x[0-9a-fA-F]{64}$`.
- Clock source: use `performance.now()` for all latency measurements; `Date.now()` reserved for externally-meaningful timestamps (e.g., `sampledAt`). Document the rule in `util/timing.ts`.
- `contracts/script/Deploy.s.sol` — replace forge-cwd-relative path with `vm.projectRoot()` + project-relative path.

## Phase C — Full measurement re-run

Estimated: 1.5 days. Requires Phase B complete (because re-running with the same bugs would invalidate the new data).

### Setup

- Single RPC provider POP for all four chains. Candidate: Alchemy (covers Sepolia, Arbitrum Sepolia, Base Sepolia, zkSync Sepolia). Verify POP equivalence before committing; pin region via `.env`.
- User task: top up testnet ETH on all four chains before running.

### Op changes

- `ops/revokeBatch.ts`: randomized revoke — select 30 indices uniformly from `[0, n)` using a seeded PRNG. Seed from `BENCH_RANDOM_SEED` env var for reproducibility; persisted into `meta.json`.
- `ops/issueBatch.ts`: N=30 repetitions for latency measurement. Gas is deterministic for issueBatch — report once.

### Runs and aggregation

- 3 independent full pipeline runs, results to `packages/benchmarks/results/run-{1,2,3}/`.
- New `stages/aggregate.ts` — read all 3 runs, compute p50/p95/mean/σ across runs, write final aggregates to `docs/l2-benchmarks/data/`.
- `meta.json` records: `N`, `runs`, `rpcProvider`, `rpcRegion`, `randomSeed`, ETH_USD snapshot date.

### Regenerated artifacts

All tables and figures under `docs/l2-benchmarks/data/`:

- `table-issue-cost.csv`
- `table-issue-per-diploma.csv`
- `table-revoke-cost.csv`
- `table-inclusion-latency.csv` (now with σ column)
- `table-read-latency.csv`
- `fig1-cost-per-diploma.dat`
- `fig2-gas-vs-l1data.dat`
- `fig3-read-latency-cdf.dat`
- `fig4-basefee-scenarios.dat`
- `meta.json`

## Phase D — Thesis-prose

Estimated: 0.5 day. Final phase, runs after C produces new data.

### Edits to `docs/univerify-l2-benchmarks.tex`

- Expand `Dyskusja → Ograniczenia pomiaru` to cover the remaining post-Phase-C caveats:
  - Arbitrum Brotli compression assumption (1.0 for pseudo-random Merkle data; structured calldata would compress further)
  - zkSync gas units are not commensurable with EVM gas — only USD/ETH comparisons are valid across rollup families
  - Inclusion latency is poll-bound at viem's ~4 s interval — upper bound, not block-inclusion latency
  - Snapshot date for Base SystemConfig scalars (block L1 25087416)
  - L2 sequencer prices are conservative round numbers above the live `eth_gasPrice` snapshot
  - `ETH_USD_SNAPSHOT_DATE` notice and sensitivity multiplier
- New sensitivity table: cost per diploma under `ETH_USD ∈ {2000, 3500, 5000}` and L2 prices at 0.5× / 1.0× / 2.0× of snapshot.
- New "Reprodukowalność" paragraph: how to run `benchmarks:all`, where to find `meta.json`, the role of `BENCH_RANDOM_SEED` and `ETH_USD_SNAPSHOT`.
- Update all tables and figure references to reflect new N≥30, σ column, 3-run aggregation.
- Final `latexmk` compile to `docs/univerify-l2-benchmarks.pdf`.

## Caveat resolution matrix

Reference: numbering from [project_phase2_writeup_caveats memory entry].

| # | Caveat | Phase that resolves it | How |
|---|---|---|---|
| 1 | Arbitrum Brotli = 1.0 | D | Prose disclosure (model assumption) |
| 2 | zkSync gas ≠ EVM gas | D | Prose disclosure (rollup-family difference) |
| 3 | Inclusion latency = polling | D | Prose disclosure (upper bound) |
| 4 | RPC vendor geography | **C** | Single POP eliminates |
| 5 | N=1 for issueBatch latency | **C** | N≥30 eliminates |
| 6 | Deterministic revoke (first 30) | **C** | Randomized revoke eliminates |
| 7 | Single run, no variance | **C** | 3 runs + σ eliminates |
| 8 | Base scalar snapshot date | D | Prose mention |
| 9 | L2 sequencer prices = round numbers | D | Prose + sensitivity table |
| 10 | ETH_USD snapshot | D | Prose + sensitivity table |

## Dependencies between phases

```
A (reproducibility) ─→ B (code robustness) ─→ C (re-run) ─→ D (prose)
                                                                 │
                                                                 └─→ Phase 2 done
```

B and C cannot start until A is complete (CI drift check must exist before code changes can be validated). C must run after B (re-running with the same bugs would invalidate the new data). D must run after C (prose references new data and σ columns).

## Estimated total

~5 working days end-to-end.
