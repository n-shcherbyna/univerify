# EIP-4844 blob basefee modeling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the pre-EIP-4844 L1 calldata cost model with a per-rollup post-4844 model so the Phase 2 L2 cost projections in `docs/l2-benchmarks/data/` reflect blob basefee economics.

**Architecture:** New `packages/benchmarks/src/cost-models/` directory with one TypeScript module per rollup (Base Ecotone, Arbitrum Nitro post-Cancun, Sepolia, zkSync). A central registry dispatches by `chainName` with an exhaustive `switch`. Each module pins its scalar constants with an L2BEAT / on-chain citation and snapshot date. `stages/price.ts` extends `PriceSample` with `blobBaseFeePerGas` (computed from `block.excessBlobGas` via the EIP-4844 `fake_exponential`); `stages/export.ts` delegates to the registry.

**Tech Stack:** TypeScript, viem, vitest. Foundry `cast` (already in repo) is used to fetch on-chain scalar values during one implementation step.

**Spec:** `docs/superpowers/specs/2026-05-13-eip-4844-blob-basefee-design.md`

---

## File map

```
packages/benchmarks/src/
  cost-models/
    types.ts         CostModel interface + PriceQuote type                        [NEW]
    index.ts         ChainKey → CostModel registry; getCostModel; totalCostWei    [NEW]
    base.ts          Ecotone formula + cited Base SystemConfig scalars            [NEW]
    arbitrum.ts      Nitro post-Cancun blob accounting                            [NEW]
    sepolia.ts       Pure L1: gasUsed × basefee                                   [NEW]
    zksync.ts        Opaque, current treatment preserved                          [NEW]
  config.ts          Remove L1_GAS_PER_CALLDATA_BYTE_ESTIMATE                     [MODIFIED]
  stages/
    price.ts         PriceSample gains blobBaseFeePerGas;                         [MODIFIED]
                     fake_exponential helper; derivePercentiles split
    export.ts        Delegate to cost-models registry; drop l1GasForL2 helper     [MODIFIED]
packages/benchmarks/tests/
  cost-models/
    base.test.ts                                                                  [NEW]
    arbitrum.test.ts                                                              [NEW]
    sepolia.test.ts                                                               [NEW]
    zksync.test.ts                                                                [NEW]
    index.test.ts    Exhaustiveness + dispatch                                    [NEW]
  stages/
    price.test.ts    Extend with blob percentiles + migration guard               [MODIFIED]
    export.test.ts   Extend with cost-model integration assertions                [MODIFIED]
  fixtures/price-history/
    tiny-prices.json Add blobBaseFeePerGas per sample                             [MODIFIED]
```

---

## Task 1: Add EIP-4844 `fakeExponential` helper

**Files:**
- Modify: `packages/benchmarks/src/stages/price.ts`
- Test: `packages/benchmarks/tests/stages/price.test.ts`

- [ ] **Step 1: Add the failing test**

In `packages/benchmarks/tests/stages/price.test.ts`, append:

```ts
import { fakeExponential } from "../../src/stages/price.js";

describe("fakeExponential (EIP-4844)", () => {
  it("returns the factor when numerator is 0", () => {
    // f(factor, 0, denominator) = factor
    expect(fakeExponential(1n, 0n, 3338477n)).toBe(1n);
  });

  it("computes blob basefee at minimum (excessBlobGas = 0)", () => {
    // MIN_BASE_FEE_PER_BLOB_GAS = 1 wei (EIP-4844)
    expect(fakeExponential(1n, 0n, 3338477n)).toBe(1n);
  });

  it("monotonically increases with excessBlobGas", () => {
    const low = fakeExponential(1n, 1_000_000n, 3338477n);
    const high = fakeExponential(1n, 5_000_000n, 3338477n);
    expect(high).toBeGreaterThan(low);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @univerify/benchmarks test -- price.test.ts`
Expected: FAIL with `fakeExponential is not exported` (or similar).

- [ ] **Step 3: Implement `fakeExponential` in `price.ts`**

Add after the existing imports in `packages/benchmarks/src/stages/price.ts`:

```ts
/**
 * EIP-4844 reference exponential approximation.
 * Returns: factor * e^(numerator / denominator) — implemented as an integer
 * Taylor series, matching the consensus-spec reference function used by
 * execution clients to derive blob basefee from excessBlobGas.
 *
 * Source: EIP-4844, "fake_exponential" pseudocode.
 */
export function fakeExponential(
  factor: bigint,
  numerator: bigint,
  denominator: bigint
): bigint {
  let i = 1n;
  let output = 0n;
  let numeratorAccum = factor * denominator;
  while (numeratorAccum > 0n) {
    output += numeratorAccum;
    numeratorAccum = (numeratorAccum * numerator) / (denominator * i);
    i += 1n;
  }
  return output / denominator;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- price.test.ts`
Expected: PASS (3 new tests).

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/stages/price.ts packages/benchmarks/tests/stages/price.test.ts
git commit -m "feat(benchmarks): add EIP-4844 fakeExponential helper"
```

---

## Task 2: Extend `PriceSample` and `fetchBasefeeHistory` to capture blob basefee

**Files:**
- Modify: `packages/benchmarks/src/stages/price.ts`
- Test: `packages/benchmarks/tests/fixtures/price-history/tiny-prices.json`
- Test: `packages/benchmarks/tests/stages/price.test.ts`

- [ ] **Step 1: Update the fixture to include blob basefee**

Replace `packages/benchmarks/tests/fixtures/price-history/tiny-prices.json` with:

```json
{
  "source": "eth_getBlockByNumber",
  "fetchedAt": "2026-05-13T12:00:00Z",
  "windowDays": 90,
  "samples": [
    { "blockNumber": 100, "baseFeePerGas": "10000000000", "blobBaseFeePerGas": "1000000000" },
    { "blockNumber": 200, "baseFeePerGas": "20000000000", "blobBaseFeePerGas": "2000000000" },
    { "blockNumber": 300, "baseFeePerGas": "30000000000", "blobBaseFeePerGas": "3000000000" },
    { "blockNumber": 400, "baseFeePerGas": "40000000000", "blobBaseFeePerGas": "4000000000" },
    { "blockNumber": 500, "baseFeePerGas": "50000000000", "blobBaseFeePerGas": "5000000000" }
  ]
}
```

- [ ] **Step 2: Modify `PriceSample` and `fetchBasefeeHistory` in `price.ts`**

Replace the `PriceSample` type and the `fetchBasefeeHistory` function in `packages/benchmarks/src/stages/price.ts` with:

```ts
export type PriceSample = {
  blockNumber: number;
  baseFeePerGas: string;
  blobBaseFeePerGas: string;
};

// EIP-4844 constants
const MIN_BASE_FEE_PER_BLOB_GAS = 1n;
const BLOB_BASE_FEE_UPDATE_FRACTION = 3338477n;

async function fetchBasefeeHistory(rpcUrl: string): Promise<PriceHistory> {
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  const latest = await client.getBlockNumber();
  const samples: PriceSample[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const bn = latest - BigInt(i) * BigInt(SAMPLE_STRIDE);
    if (bn <= 0n) break;
    const block = await client.getBlock({ blockNumber: bn });
    if (block.baseFeePerGas == null) continue;
    if (block.excessBlobGas == null) {
      throw new Error(
        `Block ${bn} predates Cancun (no excessBlobGas). The 90-day window ` +
          `must lie entirely post-Cancun; re-run after the next sync.`
      );
    }
    const blobBaseFee = fakeExponential(
      MIN_BASE_FEE_PER_BLOB_GAS,
      block.excessBlobGas,
      BLOB_BASE_FEE_UPDATE_FRACTION
    );
    samples.push({
      blockNumber: Number(bn),
      baseFeePerGas: block.baseFeePerGas.toString(),
      blobBaseFeePerGas: blobBaseFee.toString(),
    });
  }
  return {
    source: "eth_getBlockByNumber",
    fetchedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    samples,
  };
}
```

- [ ] **Step 3: Run tests (existing assertions still pass, fixture loads cleanly)**

Run: `npm -w @univerify/benchmarks test -- price.test.ts`
Expected: PASS (existing `derivePercentiles` test still passes — it reads only `baseFeePerGas`).

- [ ] **Step 4: Commit**

```bash
git add packages/benchmarks/src/stages/price.ts packages/benchmarks/tests/fixtures/price-history/tiny-prices.json
git commit -m "feat(benchmarks): capture blob basefee in 90-day price history"
```

---

## Task 3: Split `derivePercentiles` into basefee + blobBasefee percentiles

**Files:**
- Modify: `packages/benchmarks/src/stages/price.ts`
- Test: `packages/benchmarks/tests/stages/price.test.ts`

- [ ] **Step 1: Update the failing test**

Replace the existing `describe("derivePercentiles", ...)` block in `packages/benchmarks/tests/stages/price.test.ts` with:

```ts
describe("derivePercentiles", () => {
  it("returns p10/p50/p90 for basefee and blob basefee in wei (bigint)", () => {
    const { basefee, blobBasefee } = derivePercentiles(tiny);
    expect(basefee.p10).toBe(10_000_000_000n);
    expect(basefee.p50).toBe(30_000_000_000n);
    expect(basefee.p90).toBe(50_000_000_000n);
    expect(blobBasefee.p10).toBe(1_000_000_000n);
    expect(blobBasefee.p50).toBe(3_000_000_000n);
    expect(blobBasefee.p90).toBe(5_000_000_000n);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @univerify/benchmarks test -- price.test.ts`
Expected: FAIL on `Cannot read properties of undefined (reading 'p10')` (or equivalent).

- [ ] **Step 3: Update `derivePercentiles` and `Percentiles` types**

Replace the percentile types and function in `packages/benchmarks/src/stages/price.ts`:

```ts
export type Percentiles = { p10: bigint; p50: bigint; p90: bigint };
export type PriceQuotePercentiles = {
  basefee: Percentiles;
  blobBasefee: Percentiles;
};

export function derivePercentiles(h: PriceHistory): PriceQuotePercentiles {
  if (h.samples.length === 0) {
    throw new Error("derivePercentiles: empty price history");
  }
  if (h.samples[0].blobBaseFeePerGas == null) {
    throw new Error(
      "derivePercentiles: price-history file predates blob basefee support. " +
        "Re-run `benchmarks price` to fetch a fresh window with blob basefees."
    );
  }
  const pickWei = (selector: (s: PriceSample) => string): Percentiles => {
    const bigs = h.samples
      .map((s) => BigInt(selector(s)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const pick = (p: number) =>
      bigs[Math.max(0, Math.min(bigs.length - 1, Math.ceil(p * bigs.length) - 1))];
    return { p10: pick(0.1), p50: pick(0.5), p90: pick(0.9) };
  };
  return {
    basefee: pickWei((s) => s.baseFeePerGas),
    blobBasefee: pickWei((s) => s.blobBaseFeePerGas),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- price.test.ts`
Expected: PASS (updated `derivePercentiles` test now succeeds).

- [ ] **Step 5: Add migration-guard test**

Append to `packages/benchmarks/tests/stages/price.test.ts`:

```ts
describe("derivePercentiles migration guard", () => {
  it("throws a clear error when price history predates blob support", () => {
    const old = {
      source: "eth_feeHistory",
      fetchedAt: "2026-04-19T12:00:00Z",
      windowDays: 90,
      samples: [{ blockNumber: 100, baseFeePerGas: "10000000000" }],
    };
    expect(() => derivePercentiles(old as never)).toThrow(/predates blob basefee/);
  });
});
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- price.test.ts`
Expected: PASS (all 5 tests in this file).

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/stages/price.ts packages/benchmarks/tests/stages/price.test.ts
git commit -m "feat(benchmarks): split derivePercentiles by basefee and blob basefee"
```

---

## Task 4: Create `cost-models/types.ts`

**Files:**
- Create: `packages/benchmarks/src/cost-models/types.ts`

- [ ] **Step 1: Create the file**

Write `packages/benchmarks/src/cost-models/types.ts`:

```ts
// packages/benchmarks/src/cost-models/types.ts
import type { NormalizedMetrics } from "../chains/types.js";

/**
 * Mainnet basefee + blob basefee at a chosen percentile (e.g. p10/p50/p90).
 * The export stage builds one PriceQuote per percentile per row.
 */
export type PriceQuote = {
  basefeeWei: bigint;
  blobBasefeeWei: bigint;
};

export interface CostModel {
  /** Execution cost on the chain's own gas market. */
  exec(m: NormalizedMetrics, p: PriceQuote): bigint;
  /** L1 data-posting cost projected to mainnet. Zero for L1 chains. */
  l1Data(m: NormalizedMetrics, p: PriceQuote): bigint;
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `npm -w @univerify/benchmarks run build`
Expected: success, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/cost-models/types.ts
git commit -m "feat(benchmarks): add CostModel and PriceQuote types"
```

---

## Task 5: Implement `sepolia` cost model + test (simplest, sanity-checks the shape)

**Files:**
- Create: `packages/benchmarks/src/cost-models/sepolia.ts`
- Test: `packages/benchmarks/tests/cost-models/sepolia.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/cost-models/sepolia.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { sepoliaCostModel } from "../../src/cost-models/sepolia.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const m: NormalizedMetrics = {
  chainId: 11155111,
  chainName: "sepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 55_000n,
  effectiveGasPrice: 30_000_000_000n,
  l1DataFee: 0n,
  calldataBytes: 68,
  blockNumber: 100n,
  txHash: "0xaa",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("sepoliaCostModel", () => {
  it("exec = gasUsed × basefee", () => {
    const out = sepoliaCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1n,
    });
    expect(out).toBe(55_000n * 30_000_000_000n);
  });

  it("l1Data is zero (no rollup data posting)", () => {
    const out = sepoliaCostModel.l1Data(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 999_999n,
    });
    expect(out).toBe(0n);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: FAIL with `Cannot find module '.../cost-models/sepolia.js'`.

- [ ] **Step 3: Implement `sepolia.ts`**

Create `packages/benchmarks/src/cost-models/sepolia.ts`:

```ts
// packages/benchmarks/src/cost-models/sepolia.ts
//
// Sepolia is an L1 testnet; we project it to Ethereum mainnet by pricing
// execution gas at the mainnet basefee at the chosen percentile. There is
// no rollup L1-data component.

import type { CostModel } from "./types.js";

export const sepoliaCostModel: CostModel = {
  exec(m, p) {
    return BigInt(m.gasUsed) * p.basefeeWei;
  },
  l1Data() {
    return 0n;
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/cost-models/sepolia.ts packages/benchmarks/tests/cost-models/sepolia.test.ts
git commit -m "feat(benchmarks): add sepolia cost model"
```

---

## Task 6: Implement `zksync` cost model + test

**Files:**
- Create: `packages/benchmarks/src/cost-models/zksync.ts`
- Test: `packages/benchmarks/tests/cost-models/zksync.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/cost-models/zksync.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { zksyncCostModel } from "../../src/cost-models/zksync.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const m: NormalizedMetrics = {
  chainId: 300,
  chainName: "zksyncSepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 131_463n,
  effectiveGasPrice: 50_000_000n,
  l1DataFee: 0n,
  calldataBytes: 68,
  blockNumber: 100n,
  txHash: "0xcc",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("zksyncCostModel", () => {
  it("exec = gasUsed × 0.05 gwei sequencer price", () => {
    const out = zksyncCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1n,
    });
    expect(out).toBe(131_463n * 50_000_000n);
  });

  it("l1Data is zero (bundled into gasUsed; not disentangled)", () => {
    const out = zksyncCostModel.l1Data(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 999_999n,
    });
    expect(out).toBe(0n);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: FAIL on the new file.

- [ ] **Step 3: Implement `zksync.ts`**

Create `packages/benchmarks/src/cost-models/zksync.ts`:

```ts
// packages/benchmarks/src/cost-models/zksync.ts
//
// zkSync Era's reported gasUsed bundles execution + pubdata posting + proof
// + AA-bootloader overhead in a single unit that is not directly comparable
// to EVM gas. We project to mainnet using the sequencer price snapshot in
// config.ts and do not attempt to disentangle the L1 component (it is
// already inside gasUsed). See thesis Limitations section for the caveat.

import { L2_MAINNET_GAS_PRICE_WEI } from "../config.js";
import type { CostModel } from "./types.js";

const ZKSYNC_PRICE_WEI = L2_MAINNET_GAS_PRICE_WEI.zksyncSepolia!;

export const zksyncCostModel: CostModel = {
  exec(m) {
    return BigInt(m.gasUsed) * ZKSYNC_PRICE_WEI;
  },
  l1Data() {
    return 0n;
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: PASS (4 tests total in cost-models so far).

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/cost-models/zksync.ts packages/benchmarks/tests/cost-models/zksync.test.ts
git commit -m "feat(benchmarks): add zksync cost model"
```

---

## Task 7: Fetch Base Ecotone scalars from L1 SystemConfig

**Files:**
- None yet (research step — output pasted into Task 8)

- [ ] **Step 1: Read `baseFeeScalar` from Base's L1 SystemConfig**

The Base L1 SystemConfig contract on Ethereum mainnet is at
`0x73a79Fab69143498Ed3712e519A88a918e1f4072`. Read `baseFeeScalar()` (selector `0xb8456c97`):

```bash
cast call 0x73a79Fab69143498Ed3712e519A88a918e1f4072 "baseFeeScalar()(uint32)" --rpc-url "$RPC_MAINNET"
```

Note the returned value. Example output: `2269` (the actual value will differ).

- [ ] **Step 2: Read `blobBaseFeeScalar` from the same contract**

Selector `0xec707517`:

```bash
cast call 0x73a79Fab69143498Ed3712e519A88a918e1f4072 "blobBaseFeeScalar()(uint32)" --rpc-url "$RPC_MAINNET"
```

Note the returned value. Example output: `1055762` (the actual value will differ).

- [ ] **Step 3: Record both values + the snapshot date**

Write a short note in your task list with:

```
BASE_BASE_FEE_SCALAR     = <value from Step 1>
BASE_BLOB_BASE_FEE_SCALAR = <value from Step 2>
Fetched: 2026-05-13 from L1 SystemConfig 0x73a79Fab69143498Ed3712e519A88a918e1f4072
```

These get pasted into `base.ts` in the next task. No commit yet.

---

## Task 8: Implement `base` cost model + test

**Files:**
- Create: `packages/benchmarks/src/cost-models/base.ts`
- Test: `packages/benchmarks/tests/cost-models/base.test.ts`

- [ ] **Step 1: Write the failing test**

Substitute the actual values from Task 7 for `BASE_BASE_FEE_SCALAR_VALUE` and
`BASE_BLOB_BASE_FEE_SCALAR_VALUE` in this file before saving:

```ts
import { describe, it, expect } from "vitest";
import { baseCostModel } from "../../src/cost-models/base.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

// Replace these two lines with the values fetched in Task 7.
const BASE_BASE_FEE_SCALAR_VALUE = 2269n;       // placeholder — fetch first!
const BASE_BLOB_BASE_FEE_SCALAR_VALUE = 1055762n; // placeholder — fetch first!

const m: NormalizedMetrics = {
  chainId: 84532,
  chainName: "baseSepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 55_000n,
  effectiveGasPrice: 100_000n,
  l1DataFee: 1_500_000_000_000n,
  l1GasUsed: 10_000n,
  calldataBytes: 1_000,
  blockNumber: 100n,
  txHash: "0xbb",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("baseCostModel", () => {
  it("exec = gasUsed × 0.005 gwei sequencer price", () => {
    const out = baseCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    expect(out).toBe(55_000n * 5_000_000n);
  });

  it("l1Data follows the Ecotone formula and is monotonic in calldataBytes", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    const small = baseCostModel.l1Data(m, p);
    const big = baseCostModel.l1Data({ ...m, calldataBytes: 2_000 }, p);
    expect(big).toBe(small * 2n);
    expect(small).toBeGreaterThan(0n);
  });

  it("l1Data matches a hand-calculated value", () => {
    // rollupDataGas = 16 * 1000 = 16000
    // numerator = 16 * scalar_base * 30e9 + scalar_blob * 1e9
    // wei = 16000 * numerator / 16e6
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    const rollupDataGas = 16n * BigInt(m.calldataBytes);
    const numerator =
      16n * BASE_BASE_FEE_SCALAR_VALUE * p.basefeeWei +
      BASE_BLOB_BASE_FEE_SCALAR_VALUE * p.blobBasefeeWei;
    const expected = (rollupDataGas * numerator) / 16_000_000n;
    expect(baseCostModel.l1Data(m, p)).toBe(expected);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: FAIL on module-not-found for `base.js`.

- [ ] **Step 3: Implement `base.ts`** (substitute the two values from Task 7)

Create `packages/benchmarks/src/cost-models/base.ts`:

```ts
// packages/benchmarks/src/cost-models/base.ts
//
// Base (OP-stack post-Ecotone). The L2's L1FeeVault computes the L1 data
// fee per tx as:
//   rollupDataGas = 16 × calldataBytes   (conservative: treat all bytes as
//                                          non-zero @ 16 gas/byte)
//   l1FeeWei = rollupDataGas
//            × (16 · baseFeeScalar · l1BaseFee + blobBaseFeeScalar · l1BlobBaseFee)
//            ÷ 16_000_000
//
// source: Base L1 SystemConfig 0x73a79Fab69143498Ed3712e519A88a918e1f4072
// fetched: 2026-05-13

import { L2_MAINNET_GAS_PRICE_WEI } from "../config.js";
import type { CostModel } from "./types.js";

const BASE_PRICE_WEI = L2_MAINNET_GAS_PRICE_WEI.baseSepolia!;
const BASE_BASE_FEE_SCALAR = 2269n;       // ← replace with value from Task 7
const BASE_BLOB_BASE_FEE_SCALAR = 1055762n; // ← replace with value from Task 7
const BASE_DENOMINATOR = 16_000_000n;

export const baseCostModel: CostModel = {
  exec(m) {
    return BigInt(m.gasUsed) * BASE_PRICE_WEI;
  },
  l1Data(m, p) {
    const rollupDataGas = 16n * BigInt(m.calldataBytes);
    const numerator =
      16n * BASE_BASE_FEE_SCALAR * p.basefeeWei +
      BASE_BLOB_BASE_FEE_SCALAR * p.blobBasefeeWei;
    return (rollupDataGas * numerator) / BASE_DENOMINATOR;
  },
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: PASS (7 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/cost-models/base.ts packages/benchmarks/tests/cost-models/base.test.ts
git commit -m "feat(benchmarks): add Base Ecotone L1 cost model with snapshotted scalars"
```

---

## Task 9: Implement `arbitrum` cost model + test

**Files:**
- Create: `packages/benchmarks/src/cost-models/arbitrum.ts`
- Test: `packages/benchmarks/tests/cost-models/arbitrum.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/cost-models/arbitrum.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { arbitrumCostModel } from "../../src/cost-models/arbitrum.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const m: NormalizedMetrics = {
  chainId: 421614,
  chainName: "arbitrumSepolia",
  op: "issueBatch",
  batchSize: 100,
  tag: "main",
  gasUsed: 55_000n,
  effectiveGasPrice: 100_000_000n,
  l1DataFee: 0n,
  l1GasUsed: 0n,
  calldataBytes: 1_000,
  blockNumber: 100n,
  txHash: "0xdd",
  submittedAt: 0,
  includedAt: 100,
  inclusionLatencyMs: 100,
};

describe("arbitrumCostModel", () => {
  it("exec = gasUsed × 0.1 gwei sequencer price", () => {
    const out = arbitrumCostModel.exec(m, {
      basefeeWei: 30_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    expect(out).toBe(55_000n * 100_000_000n);
  });

  it("l1Data = calldataBytes × ARB_BLOB_GAS_PER_BYTE × blobBasefeeWei", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    // For ARB_BLOB_GAS_PER_BYTE = 1 and ratio 1.0:
    //   1000 bytes × 1 × 1e9 wei = 1e12 wei
    expect(arbitrumCostModel.l1Data(m, p)).toBe(1_000n * 1_000_000_000n);
  });

  it("l1Data is monotonic in calldataBytes", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1_000_000_000n };
    const small = arbitrumCostModel.l1Data(m, p);
    const big = arbitrumCostModel.l1Data({ ...m, calldataBytes: 2_000 }, p);
    expect(big).toBe(small * 2n);
  });

  it("l1Data is independent of basefee (only blob basefee matters)", () => {
    const a = arbitrumCostModel.l1Data(m, {
      basefeeWei: 1_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    const b = arbitrumCostModel.l1Data(m, {
      basefeeWei: 100_000_000_000n,
      blobBasefeeWei: 1_000_000_000n,
    });
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: FAIL on module-not-found for `arbitrum.js`.

- [ ] **Step 3: Implement `arbitrum.ts`**

Create `packages/benchmarks/src/cost-models/arbitrum.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: PASS (11 tests total in cost-models).

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/cost-models/arbitrum.ts packages/benchmarks/tests/cost-models/arbitrum.test.ts
git commit -m "feat(benchmarks): add Arbitrum Nitro post-Cancun L1 cost model"
```

---

## Task 10: Create `cost-models/index.ts` (registry + dispatch + exhaustiveness)

**Files:**
- Create: `packages/benchmarks/src/cost-models/index.ts`
- Test: `packages/benchmarks/tests/cost-models/index.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/cost-models/index.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { getCostModel, totalCostWei } from "../../src/cost-models/index.js";
import { baseCostModel } from "../../src/cost-models/base.js";
import { arbitrumCostModel } from "../../src/cost-models/arbitrum.js";
import { sepoliaCostModel } from "../../src/cost-models/sepolia.js";
import { zksyncCostModel } from "../../src/cost-models/zksync.js";
import type { NormalizedMetrics } from "../../src/chains/types.js";

const sepoliaM: NormalizedMetrics = {
  chainId: 11155111, chainName: "sepolia", op: "issueBatch", batchSize: 1, tag: "main",
  gasUsed: 55_000n, effectiveGasPrice: 30_000_000_000n, l1DataFee: 0n,
  calldataBytes: 68, blockNumber: 100n, txHash: "0xaa",
  submittedAt: 0, includedAt: 100, inclusionLatencyMs: 100,
};

describe("getCostModel", () => {
  it("dispatches by chainName to the right model", () => {
    expect(getCostModel("sepolia")).toBe(sepoliaCostModel);
    expect(getCostModel("baseSepolia")).toBe(baseCostModel);
    expect(getCostModel("arbitrumSepolia")).toBe(arbitrumCostModel);
    expect(getCostModel("zksyncSepolia")).toBe(zksyncCostModel);
  });

  it("throws on unknown chainName", () => {
    expect(() => getCostModel("unknown")).toThrow(/unknown chain/i);
  });
});

describe("totalCostWei", () => {
  it("returns exec + l1Data for a sepolia metric", () => {
    const p = { basefeeWei: 30_000_000_000n, blobBasefeeWei: 1n };
    expect(totalCostWei(sepoliaM, p)).toBe(55_000n * 30_000_000_000n);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: FAIL on module-not-found for `cost-models/index.js`.

- [ ] **Step 3: Implement `index.ts`**

Create `packages/benchmarks/src/cost-models/index.ts`:

```ts
// packages/benchmarks/src/cost-models/index.ts
import type { ChainKey } from "../config.js";
import type { NormalizedMetrics } from "../chains/types.js";
import { arbitrumCostModel } from "./arbitrum.js";
import { baseCostModel } from "./base.js";
import { sepoliaCostModel } from "./sepolia.js";
import type { CostModel, PriceQuote } from "./types.js";
import { zksyncCostModel } from "./zksync.js";

export type { CostModel, PriceQuote } from "./types.js";

const REGISTRY: Record<ChainKey, CostModel> = {
  sepolia: sepoliaCostModel,
  baseSepolia: baseCostModel,
  arbitrumSepolia: arbitrumCostModel,
  zksyncSepolia: zksyncCostModel,
};

export function getCostModel(chainName: string): CostModel {
  switch (chainName as ChainKey) {
    case "sepolia":
    case "baseSepolia":
    case "arbitrumSepolia":
    case "zksyncSepolia":
      return REGISTRY[chainName as ChainKey];
    default: {
      const _exhaustive: never = chainName as never;
      throw new Error(`unknown chainName: ${chainName} (${_exhaustive})`);
    }
  }
}

export function totalCostWei(m: NormalizedMetrics, p: PriceQuote): bigint {
  const model = getCostModel(m.chainName);
  return model.exec(m, p) + model.l1Data(m, p);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- cost-models`
Expected: PASS (14 tests total).

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/cost-models/index.ts packages/benchmarks/tests/cost-models/index.test.ts
git commit -m "feat(benchmarks): add cost-models registry with exhaustive chain dispatch"
```

---

## Task 11: Wire `export.ts` to the cost-models registry

**Files:**
- Modify: `packages/benchmarks/src/stages/export.ts`
- Modify: `packages/benchmarks/src/config.ts`

- [ ] **Step 1: Remove `L1_GAS_PER_CALLDATA_BYTE_ESTIMATE` from `config.ts`**

Delete the entire block in `packages/benchmarks/src/config.ts` starting with the comment
`/** Per-L2 estimate of L1 gas per calldata byte ...` and ending with the closing `};` of
`L1_GAS_PER_CALLDATA_BYTE_ESTIMATE`. Keep everything else.

- [ ] **Step 2: Replace the imports in `export.ts`**

In `packages/benchmarks/src/stages/export.ts`, change the imports block at the top of the file
from:

```ts
import {
  BATCH_SIZES,
  L1_GAS_PER_CALLDATA_BYTE_ESTIMATE,
  L2_MAINNET_GAS_PRICE_WEI,
  type ChainKey,
} from "../config.js";
import { derivePercentiles, type PriceHistory } from "./price.js";
```

to:

```ts
import { BATCH_SIZES, L2_MAINNET_GAS_PRICE_WEI, type ChainKey } from "../config.js";
import {
  getCostModel,
  totalCostWei,
  type PriceQuote,
} from "../cost-models/index.js";
import { derivePercentiles, type PriceHistory } from "./price.js";
```

- [ ] **Step 3: Delete the local `l1GasForL2` and `totalCostWei` functions**

The imported `totalCostWei` from `../cost-models/index.js` now provides this. Delete the entire
local `l1GasForL2` function and the entire local `totalCostWei` function from `export.ts`.

- [ ] **Step 4: Update each table writer to build `PriceQuote` values from the new percentiles shape**

For each writer that currently destructures `const { p10, p50, p90 } = derivePercentiles(prices);`,
replace it with the version below. The writers and which percentiles they use:

| Writer | Percentiles used |
|---|---|
| `writeIssueCostTable` | p10, p50, p90 |
| `writeIssuePerDiplomaTable` | p50 only |
| `writeRevokeCostTable` | p50 only |
| `writeFigCostPerDiploma` | p50 only |
| `writeFigBasefeeScenarios` | p10, p50, p90 |

For writers using all three:

```ts
const { basefee, blobBasefee } = derivePercentiles(prices);
const q10: PriceQuote = { basefeeWei: basefee.p10, blobBasefeeWei: blobBasefee.p10 };
const q50: PriceQuote = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
const q90: PriceQuote = { basefeeWei: basefee.p90, blobBasefeeWei: blobBasefee.p90 };
```

For writers using only p50:

```ts
const { basefee, blobBasefee } = derivePercentiles(prices);
const q50: PriceQuote = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
```

Then replace every `totalCostWei(m, p10)` → `totalCostWei(m, q10)`, every `totalCostWei(m, p50)`
→ `totalCostWei(m, q50)`, and every `totalCostWei(m, p90)` → `totalCostWei(m, q90)`.

- [ ] **Step 5: Rewrite `writeFigGasVsL1Data` to use the model breakdown**

Replace the body of `writeFigGasVsL1Data` in `export.ts` with:

```ts
export function writeFigGasVsL1Data(
  run: RunResults,
  outDir: string,
  prices?: PriceHistory
): string {
  const datPath = path.join(outDir, "fig2-gas-vs-l1data.dat");
  const header = "chain execution_wei l1data_wei";
  const rows: string[] = [];

  let q50: PriceQuote | null = null;
  if (prices) {
    const { basefee, blobBasefee } = derivePercentiles(prices);
    q50 = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
  }

  for (const [chain, data] of Object.entries(run.chains)) {
    const m = data.issueBatch.find((x) => x.tag === "main" && x.batchSize === 1000);
    if (!m) continue;
    const model = getCostModel(m.chainName);
    // When prices are absent (test path), fall back to measured testnet values
    // so the existing structural test on the empty fixture still works.
    const q = q50 ?? { basefeeWei: BigInt(m.effectiveGasPrice), blobBasefeeWei: 0n };
    const exec = model.exec(m, q);
    const l1Wei = q50 != null ? model.l1Data(m, q) : BigInt(m.l1DataFee);
    rows.push([chain, exec.toString(), l1Wei.toString()].join(" "));
  }

  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}
```

- [ ] **Step 6: Type-check + run existing tests**

Run: `npm -w @univerify/benchmarks run build`
Expected: success.

Run: `npm -w @univerify/benchmarks test`
Expected: existing `export.test.ts` still passes (it only checks structural shape — USD column
values change but the assertions are presence/structure, not specific numbers).

If any test fails because it asserts a specific USD value, update the assertion to recompute the
expected value via the cost-models registry, not via the old formula.

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/stages/export.ts packages/benchmarks/src/config.ts
git commit -m "refactor(benchmarks): delegate cost projection to per-rollup cost-models"
```

---

## Task 12: Extend `export.test.ts` to assert cost-model integration

**Files:**
- Modify: `packages/benchmarks/tests/stages/export.test.ts`

- [ ] **Step 1: Add an integration assertion**

Append to `packages/benchmarks/tests/stages/export.test.ts`:

```ts
import { totalCostWei } from "../../src/cost-models/index.js";

describe("writeIssueCostTable cost-model integration", () => {
  it("USD p50 column for baseSepolia matches the cost-model output", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const csvPath = writeIssueCostTable(tiny as never, tinyPrices as never, tmp);
      const csv = fs.readFileSync(csvPath, "utf8");
      const lines = csv.trim().split("\n");
      const header = lines[0].split(",");
      const baseRow = lines.find((l) => l.startsWith("baseSepolia"))!.split(",");
      const colName = "usd_p50_100";
      const idx = header.indexOf(colName);
      expect(idx).toBeGreaterThan(-1);

      // Recompute expected USD from cost-models + tiny prices p50 + ETH_USD = 3500
      const m100 = (tiny as never as { chains: Record<string, { issueBatch: never[] }> })
        .chains.baseSepolia.issueBatch.find((x: never) =>
          (x as { batchSize: number }).batchSize === 100
        ) as never;
      const normalized = {
        ...(m100 as object),
        gasUsed: BigInt((m100 as { gasUsed: string }).gasUsed),
        effectiveGasPrice: BigInt((m100 as { effectiveGasPrice: string }).effectiveGasPrice),
        l1DataFee: BigInt((m100 as { l1DataFee: string }).l1DataFee),
        l1GasUsed: BigInt((m100 as { l1GasUsed: string }).l1GasUsed),
        blockNumber: BigInt((m100 as { blockNumber: string }).blockNumber),
      };
      // p50 from tinyPrices = basefee 30 gwei, blob basefee 3 gwei
      const wei = totalCostWei(normalized as never, {
        basefeeWei: 30_000_000_000n,
        blobBasefeeWei: 3_000_000_000n,
      });
      const expectedUsd = (Number(wei) / 1e18) * 3500;
      const actualUsd = Number(baseRow[idx]);
      expect(actualUsd).toBeCloseTo(expectedUsd, 6);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it passes**

Run: `npm -w @univerify/benchmarks test -- export.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/tests/stages/export.test.ts
git commit -m "test(benchmarks): assert export CSV matches cost-model output for Base"
```

---

## Task 13: Final integration: full test suite + re-export

**Files:**
- None modified by default (verification only)

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all packages pass, including `@univerify/benchmarks`.

- [ ] **Step 2: Build the workspace in order**

Run: `npm run build`
Expected: success across `verifier-core → sdk → cli → web` plus benchmarks.

- [ ] **Step 3: Re-fetch price history with blob basefee**

Run: `cd packages/benchmarks && npm run price`
Expected: a new file under `benchmarks/price-history/2026-05-13.json` (or current date) with
`blobBaseFeePerGas` populated on every sample.

If `RPC_MAINNET` is not set, set it (any public RPC works for `eth_getBlockByNumber`).

- [ ] **Step 4: Re-export tables and figures**

Run: `cd packages/benchmarks && npm run export`
Expected: all 11 files written under `docs/l2-benchmarks/data/`.

- [ ] **Step 5: Manual sanity check on the new numbers**

Open `docs/l2-benchmarks/data/table-issue-cost.csv` and confirm:

- Base's `usd_p50_*` columns are roughly 10× **lower** than the values committed in `b22f903`.
- Arbitrum's `usd_p50_*` columns are now **non-zero** (previously zero on Sepolia after the
  calldata fallback).
- Sepolia's `usd_p50_*` columns are roughly unchanged (within rounding from refetching basefee
  percentiles).

If a column moves in an unexpected direction, stop and re-check the corresponding cost-model
formula and scalar values.

- [ ] **Step 6: Commit the regenerated data files**

```bash
git add docs/l2-benchmarks/data/
git commit -m "chore(benchmarks): regenerate cost tables with EIP-4844 blob basefee model"
```

---

## Acceptance criteria (re-stated from spec)

1. `forge test` passes (no contracts touched; runs unchanged).
2. `npm test` passes — all new cost-model tests + extended price/export tests.
3. `npm -w @univerify/benchmarks run price` produces a price-history file with
   `blobBaseFeePerGas` per sample.
4. `npm -w @univerify/benchmarks run export` regenerates CSVs / dat files under
   `docs/l2-benchmarks/data/` using the new cost models.
5. Manual inspection of `table-issue-cost.csv`:
   - Base `usd_p50_*` columns drop ~10× from `b22f903` values.
   - Arbitrum `usd_p50_*` columns gain a non-zero L1 component.
   - Sepolia `usd_p50_*` columns are unchanged within rounding.
6. Every constant in `cost-models/*.ts` carries a top-of-file citation comment with a source +
   snapshot date.
