# EIP-4844 blob basefee modeling for L2 cost projection

**Date:** 2026-05-13
**Branch:** `feat/l2-benchmarks`
**Phase:** 2 (L2 benchmarks)
**Author:** Nazar Shcherbyna

## Problem

The Phase 2 cost projection in `packages/benchmarks/src/stages/export.ts` prices L1 data posting at
`l1GasUsed × L1_mainnet_basefee`. This is the pre-EIP-4844 calldata model. Since March 2024, OP-stack
(Base) and Arbitrum Nitro post batches via blob transactions priced on `blobBaseFee`, decoupled from
L1 execution basefee.

Effects on the current numbers:

- **Base** is overstated by ~10× — typical blob basefee is far below typical L1 execution basefee, and Base's L1 data fee derives from the former.
- **Arbitrum Sepolia** reports `l1GasUsed = 0` (testnet waives the L1 fee). A previous fix (`4480af3`) added a per-byte fallback (`L1_GAS_PER_CALLDATA_BYTE_ESTIMATE`) using a pre-4844 calldata model — this still understates Arbitrum's true mainnet posting cost.

A senior-developer review on 2026-05-12 flagged this as the single biggest correctness issue in the
chapter. The fix is a re-export over the existing measurement results — no re-measurement needed.

## Goal

Replace the L1 data component of the cost projection with a per-rollup post-4844 model, parameterized
by hardcoded constants cited from L2BEAT / each rollup's published config on a snapshot date.

Non-goals for this change:
- L2 sequencer prices (`L2_MAINNET_GAS_PRICE_WEI`) stay as round numbers; addressed separately.
- `ETH_USD = 3500` stays hardcoded; addressed separately.
- No re-measurement; existing `benchmarks/results/*.json` is re-exported with the new model.
- No thesis prose written in this change.

## Design decisions (settled in brainstorming)

1. **Per-rollup parametric model.** Each rollup gets its own formula (OP-stack Ecotone vs Arb Nitro
   post-Cancun), each pinned with its own constants. A "uniform blob model" was rejected as too
   imprecise for a defensible chapter.
2. **Hardcoded constants with citation + snapshot date.** Reading values live from each rollup's
   on-chain config (Base `SystemConfig`, Arb `ArbGasInfo`) was rejected — re-running the export
   later would silently produce different numbers and the thesis tables would stop reproducing.
3. **Replace cleanly, no side-by-side pre/post-4844 columns.** Tables show only the post-4844
   projection. The Limitations chapter narrates the bug-fix story textually; the data tables
   stay clean.
4. **Per-rollup cost-model modules** (one file per rollup), not an inline switch or a
   parameter-struct unification. Best testability, formulas documented next to their constants,
   easy to extend in Phase 3.

## Architecture

### File-level changes

```
packages/benchmarks/src/
  cost-models/                    [NEW]
    types.ts                      CostModel interface, PriceQuote type
    index.ts                      ChainKey → CostModel registry; totalCostWei + breakdown
    base.ts                       OP-stack Ecotone formula + cited scalars
    arbitrum.ts                   Arb Nitro post-Cancun blob accounting
    sepolia.ts                    pure L1: gasUsed × basefee
    zksync.ts                     current opaque treatment, kept explicit
  config.ts                       [MODIFIED]
    Remove L1_GAS_PER_CALLDATA_BYTE_ESTIMATE (subsumed by arbitrum.ts)
    Keep L2_MAINNET_GAS_PRICE_WEI (separate follow-up)
  stages/
    price.ts                      [MODIFIED]
      PriceSample gains blobBaseFeePerGas: string
      derivePercentiles returns { basefee: Percentiles, blobBasefee: Percentiles }
      fetchBasefeeHistory reads block.excessBlobGas, computes blob basefee
    export.ts                     [MODIFIED]
      totalCostWei delegates to cost-models registry
      l1GasForL2 deleted
      writeFigGasVsL1Data uses model's exec/l1Data breakdown
  tests/
    cost-models/                  [NEW]
      base.test.ts                Pinned synthetic + monotonicity
      arbitrum.test.ts            Pinned synthetic + monotonicity
      sepolia.test.ts             Trivial assertions
      zksync.test.ts              Sequencer price + l1Data=0
    stages/
      price.test.ts               Extended: blob percentiles
      export.test.ts              Fixtures updated; USD columns match models
    fixtures/price-history/
      tiny-prices.json            Gains blobBaseFeePerGas field
```

### Data flow

```
stagePrice() ──> price-history/YYYY-MM-DD.json {basefee + blob basefee per daily sample}
                          │
stageMeasure() ──> results/<runId>.json  (unchanged, no re-measurement)
                          │
                          ▼
stageExport()  ──> for each metric m:
                     model   = costModels[m.chainName]
                     execWei = model.exec(m, percentiles)
                     l1Wei   = model.l1Data(m, blobPercentiles)
                     totalCostWei = execWei + l1Wei
                   ──> CSV/dat files in docs/l2-benchmarks/data/
```

### `CostModel` interface

The existing `totalCostWei` is called three times per CSV row (once for each of p10/p50/p90), so
the caller already picks the percentile. The model takes the concrete `wei` values at that
percentile, not the full distribution.

```ts
type PriceQuote = {
  basefeeWei: bigint;       // L1 execution basefee at chosen percentile
  blobBasefeeWei: bigint;   // L1 blob basefee at chosen percentile
};

interface CostModel {
  // Execution cost on the chain's own gas market (L2 sequencer or L1 basefee).
  exec(m: NormalizedMetrics, p: PriceQuote): bigint;
  // L1 data-posting cost projected to mainnet. Zero for L1 chains.
  l1Data(m: NormalizedMetrics, p: PriceQuote): bigint;
}

// Top-level helper (replaces current totalCostWei):
function totalCostWei(m: NormalizedMetrics, p: PriceQuote): bigint {
  const model = getCostModel(m.chainName);
  return model.exec(m, p) + model.l1Data(m, p);
}
```

`Percentiles` (the existing `{p10, p50, p90}` type from `price.ts`) stays as-is and is still
returned by `derivePercentiles`. The call site in `export.ts` constructs three `PriceQuote`
values from the basefee and blob-basefee percentile triples.

A helper `getCostModel(chainName: string): CostModel` does an exhaustive `switch` with
`const _: never = chainName`, which also closes the unchecked `chainName as ChainKey` cast flagged
in [[project_phase2_code_followups]] — a free side-effect of this refactor.

## Per-rollup formulas

### `base.ts` — OP-stack Ecotone (post-March 2024)

The L2's `L1FeeVault` computes the L1 data fee per tx:

```
rollupDataGas = 16 · calldataBytes
                (conservative: Merkle batch data is mostly non-zero, so we
                 approximate all bytes as nonzero @ 16 gas/byte)

l1FeeWei = rollupDataGas
         × (16 · baseFeeScalar · l1BaseFee + blobBaseFeeScalar · l1BlobBaseFee)
         ÷ 16_000_000
```

Snapshotted constants (`// source: L2BEAT / Base SystemConfig, fetched 2026-05-13`):

- `BASE_BASE_FEE_SCALAR` — small four-digit integer
- `BASE_BLOB_BASE_FEE_SCALAR` — six-digit integer
- `BASE_DENOMINATOR = 16_000_000n`

The implementation will fetch the actual snapshot values from L2BEAT during implementation and
pin them with a citation comment.

`exec(m, prices) = m.gasUsed × L2_MAINNET_GAS_PRICE_WEI.baseSepolia` (unchanged from current).

### `arbitrum.ts` — Nitro post-Cancun (post-April 2024)

Arbitrum publishes Brotli-compressed batches to blobs. For Merkle-tree data (mostly pseudo-random
hash bytes) the compression ratio is ~1.0.

```
compressedBytes = calldataBytes × BROTLI_COMPRESSION_RATIO   (= calldataBytes · 1.0)
l1FeeWei = compressedBytes × ARB_BLOB_GAS_PER_BYTE × l1BlobBaseFee
```

Snapshotted constants (`// source: L2BEAT / Arbitrum docs, fetched 2026-05-13`):

- `ARB_BLOB_GAS_PER_BYTE` — single-digit integer
- `ARB_BROTLI_COMPRESSION_RATIO = 1` (integer; code comment explains why this is conservative
  for hash-pseudo-random data)

This **replaces** the existing `L1_GAS_PER_CALLDATA_BYTE_ESTIMATE = 10` fallback added in commit
`4480af3`. The old constant is deleted from `config.ts`.

`exec(m, prices) = m.gasUsed × L2_MAINNET_GAS_PRICE_WEI.arbitrumSepolia` (unchanged from current).

### `sepolia.ts` — pure L1

```
exec(m, p)   = m.gasUsed × p.basefeeWei
l1Data(m, _) = 0n
```

Written explicitly so the cost-models registry has no implicit fallback path.

### `zksync.ts` — opaque, current treatment preserved

```
exec(m, _)   = m.gasUsed × L2_MAINNET_GAS_PRICE_WEI.zksyncSepolia
l1Data(m, _) = 0n   // L1 component is bundled into gasUsed; not disentangled
```

Module-level comment cites the zkSync gas-incommensurability limitation already documented in
the writeup caveats.

## Price history

`PriceSample` extends with one field:

```ts
type PriceSample = {
  blockNumber: number;
  baseFeePerGas: string;
  blobBaseFeePerGas: string;   // NEW — computed from block.excessBlobGas
};
```

Blob basefee is computed from EIP-4844's exponential formula on `excessBlobGas`:

```
blobBaseFee = fake_exponential(MIN_BASE_FEE_PER_BLOB_GAS,
                               excessBlobGas,
                               BLOB_BASE_FEE_UPDATE_FRACTION)
            ≈ MIN_BLOB_BASE_FEE · e^(excessBlobGas / UPDATE_FRACTION)
```

Implementation uses the integer-approximation `fake_exponential` from the EIP-4844 spec
(reproducible to wei from `block.excessBlobGas` alone — no extra RPC call).

`derivePercentiles(h: PriceHistory)` returns:

```ts
{
  basefee: { p10, p50, p90 },
  blobBasefee: { p10, p50, p90 },
}
```

## Migration & edge cases

| Case | Behavior |
|---|---|
| Existing price-history file lacks `blobBaseFeePerGas` | Error with message: "Re-run `benchmarks price` — this file predates blob basefee support." No silent upgrades. |
| Existing `results/*.json` from `b22f903` | Used as-is. No re-measurement. |
| 90-day window crosses Cancun boundary | Cannot happen on today's date (2026-05-13); assert every sampled block has `excessBlobGas` and error out otherwise. |
| Unknown `chainName` | Exhaustive switch in `getCostModel` catches at compile time via `const _: never`. |
| `m.calldataBytes == null` (defensive) | `l1Data` returns `0n`; logged one-time warning. Production data always has it. |

`NormalizedMetrics.l1DataFee` / `l1GasUsed` fields stay in the data model and the CSV `l1data_wei_*`
columns (raw testnet receipt values) but are no longer used by the cost computation. A comment in
`export.ts` makes the distinction explicit: `l1data_wei` columns report testnet receipt values;
USD columns report mainnet projections via cost models.

## Testing

| Test | What it covers |
|---|---|
| `cost-models/base.test.ts` | Pinned synthetic: known inputs → expected wei (hand-calculated). Monotonicity: 2× bytes → 2× cost. |
| `cost-models/arbitrum.test.ts` | Same shape as Base. |
| `cost-models/sepolia.test.ts` | `l1Data` returns `0n`; `exec` returns `gasUsed × basefee`. |
| `cost-models/zksync.test.ts` | `exec` uses sequencer price; `l1Data` returns `0n`. |
| `stages/price.test.ts` (extend) | `derivePercentiles` returns blob percentiles too. |
| `stages/export.test.ts` (extend) | `writeIssueCostTable` USD columns match cost-model output on the tiny fixture. |

Fixture update: `tests/fixtures/price-history/tiny-prices.json` gains `blobBaseFeePerGas` per
sample. `tiny-run.json` is unchanged.

Optional manual sanity check (not in CI): pick one real Base mainnet batch-posting tx from
Etherscan, plug its calldata bytes + the basefees at that block into our model, confirm within
~5% of the receipt's `l1Fee`. Documented in code comment, not automated.

## Acceptance criteria

1. `forge test` passes.
2. `npm test` passes.
3. `npm -w @univerify/benchmarks run price` produces a price-history file containing
   `blobBaseFeePerGas` for every sample.
4. `npm -w @univerify/benchmarks run export` regenerates all CSVs / dat files under
   `docs/l2-benchmarks/data/`.
5. Manual inspection of the regenerated `table-issue-cost.csv`:
   - Base's `usd_p50_*` columns drop ~10× from current values.
   - Arbitrum's `usd_p50_*` columns gain a non-zero L1 component (currently zero on testnet
     after the calldata fallback, will be replaced by the new blob model).
   - Sepolia's columns are unchanged (within rounding from re-fetching basefee history).
6. Every constant in `cost-models/*.ts` has a top-of-file citation comment with the snapshot
   date and source.

## Related memory

- [[project_phase2_writeup_caveats]] — item 1 (this caveat) is resolved by this change.
- [[project_phase2_code_followups]] — the unchecked `chainName as ChainKey` cast is closed as a
  side-effect.
- Phase 2 priority list — items B (L2 sequencer price snapshots), C (ETH/USD provenance), D, E, F
  remain after this change.
