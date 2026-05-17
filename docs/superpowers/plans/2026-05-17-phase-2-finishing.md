# Phase 2 — Professional Finishing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close Phase 2 in a state defensible at the master's thesis defense, with reproducible scaffolding that Phase 3 (privacy gas benchmarks) can reuse.

**Architecture:** Four sequential phases — (A) reproducibility scaffolding, (B) code robustness & opsec, (C) full measurement re-run with randomized revoke and N≥30 across 3 runs through a single RPC POP, (D) thesis-prose expansion. Each phase has tightly scoped tasks producing self-contained, committable changes.

**Tech Stack:** TypeScript + viem (benchmarks pipeline), Solidity + Foundry (contracts), Vitest (tests), GitHub Actions (CI), LaTeX/Polish (thesis).

**Spec:** `docs/superpowers/specs/2026-05-17-phase-2-finishing-design.md`

---

## File Structure

**Phase A:**
- Modify: `packages/benchmarks/src/index.ts` — extend `all` command to include `deploy`, add `--runs` flag
- Create: `packages/benchmarks/README.md` — pipeline overview and reproduction instructions
- Modify: `CHANGELOG.md` — Phase 2 final entry
- Create: `.github/workflows/benchmarks-drift.yml` — regenerate data/ from committed results, diff
- Create: `packages/benchmarks/results/fixture-run.json` — committed reference results for CI

**Phase B:**
- Modify: `packages/benchmarks/src/stages/deploy.ts` — `execSync` → `execFileSync`
- Create: `packages/benchmarks/src/util/nonceManager.ts` — local nonce + retry with gas bump
- Create: `packages/benchmarks/tests/util/nonceManager.test.ts`
- Modify: `packages/benchmarks/src/ops/issueBatch.ts` — integrate nonce manager
- Modify: `packages/benchmarks/src/ops/revokeBatch.ts` — integrate nonce manager
- Modify: `packages/benchmarks/src/stages/measure.ts` — atomic writes, per-(chain,op,batchSize) resume schema, binary-search nextBatchId, SIGINT handler
- Create: `packages/benchmarks/tests/stages/measure.test.ts` — covers atomic write, schema, binary search
- Modify: `packages/benchmarks/src/stages/export.ts` — exhaustiveness switch on `chainName`
- Modify: `packages/benchmarks/src/util/wallet.ts` — hex regex validation
- Modify: `packages/benchmarks/tests/util/wallet.test.ts` (create if missing) — boundary cases
- Modify: `packages/benchmarks/src/util/timing.ts` — clock-source policy comment
- Modify: `packages/benchmarks/src/ops/readLatency.ts` — verify clock policy compliance
- Modify: `contracts/script/Deploy.s.sol` — `vm.projectRoot()`-based path

**Phase C:**
- Modify: `packages/benchmarks/src/config.ts` — add `BENCH_RANDOM_SEED` and `LATENCY_REPS`, document single-POP requirement
- Create: `packages/benchmarks/src/util/prng.ts` — seeded PRNG (Mulberry32) + sampleWithoutReplacement
- Create: `packages/benchmarks/tests/util/prng.test.ts`
- Modify: `packages/benchmarks/src/ops/revokeBatch.ts` — uniform random index selection
- Modify: `packages/benchmarks/src/ops/issueBatch.ts` — accept `repetitions` for latency
- Modify: `packages/benchmarks/src/stages/measure.ts` — track 3 runs, write to `run-N/` subdirs
- Create: `packages/benchmarks/src/stages/aggregate.ts` — merge 3 runs into final tables
- Create: `packages/benchmarks/tests/stages/aggregate.test.ts`
- Modify: `packages/benchmarks/src/stages/export.ts` — accept aggregated input with σ column
- Modify: `packages/benchmarks/src/index.ts` — wire `aggregate` command and update `all`

**Phase D:**
- Modify: `docs/univerify-l2-benchmarks.tex` — expand limitations, sensitivity table, reproducibility paragraph

---

# Phase A — Reproducibility scaffolding

Goal: Single-command reproduction (`npm run benchmarks:all`) plus a CI drift check so the committed `docs/l2-benchmarks/data/` cannot silently rot.

## Task A.1: Extend `all` orchestrator with deploy and `--runs` flag

**Files:**
- Modify: `packages/benchmarks/src/index.ts`

- [ ] **Step 1: Read current `all` case**

The current `all` case at `packages/benchmarks/src/index.ts:37-42` runs `measure → price → export`. We need `deploy → measure → price → export` with an optional `--runs=N` flag for Phase C, and an optional `--chain=KEY` filter.

- [ ] **Step 2: Replace `all` case**

Replace lines 37-42 with:

```ts
    case "all": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      const runs = Number(argValue(rest, "runs") ?? "1");
      if (!Number.isInteger(runs) || runs < 1) {
        throw new Error(`--runs must be a positive integer, got ${runs}`);
      }
      await stageDeploy(only);
      for (let r = 1; r <= runs; r++) {
        if (runs > 1) console.log(`[all] run ${r}/${runs}`);
        await stageMeasure({ only, runLabel: runs > 1 ? `run-${r}` : undefined });
      }
      await stagePrice();
      stageExport({});
      return;
    }
```

The `runLabel` option will be added to `stageMeasure` in Task C.5; for now it's a no-op when undefined and the typecheck will fail until C.5 is done. To keep the build green between phases, **temporarily** drop the `runLabel` parameter and just iterate `stageMeasure({ only })`. We'll re-introduce it in Task C.5.

- [ ] **Step 3: Update usage string**

Update line 52:

```ts
"Usage: benchmarks {deploy|measure|price|export|all|smoke} [--chain=KEY] [--resume=RUN_ID] [--runs=N]"
```

- [ ] **Step 4: Build and verify**

```bash
npm -w @univerify/benchmarks run build
```

Expected: clean build.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/index.ts
git commit -m "feat(benchmarks): include deploy in 'all' orchestrator, add --runs flag"
```

## Task A.2: Write `packages/benchmarks/README.md`

**Files:**
- Create: `packages/benchmarks/README.md`

- [ ] **Step 1: Write the README**

Write to `packages/benchmarks/README.md`:

````markdown
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
````

- [ ] **Step 2: Commit**

```bash
git add packages/benchmarks/README.md
git commit -m "docs(benchmarks): add README with reproduction instructions and limitations"
```

## Task A.3: Add CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Prepend new section**

Insert after the `# Changelog` / `[Keep a Changelog]` header (above the `## [0.1.0]` block):

```markdown
## [0.2.0] - 2026-05-17

### Added

- `@univerify/benchmarks` — L2 cost & latency benchmark pipeline (deploy → measure → price → export → aggregate)
- Per-rollup parametric cost models with EIP-4844 blob basefee accounting (`src/cost-models/{sepolia,base,arbitrum,zksync}.ts`)
- Base Ecotone L1-fee formula with snapshotted SystemConfig scalars (`baseFeeScalar=2269`, `blobBaseFeeScalar=1055762`, L1 block 25087416)
- Arbitrum Nitro post-Cancun blob accounting (1.0 Brotli ratio assumption, documented)
- Live blob basefee fetched via `eth_feeHistory` (Pectra-safe; no local `fakeExponential`)
- L2 sequencer prices and ETH/USD snapshot cited and env-overridable
- Phase 2 thesis chapter `docs/univerify-l2-benchmarks.tex` with generated tables under `docs/l2-benchmarks/data/`
- `npm run benchmarks:all` single-command reproduction with `--runs=N` aggregation
- CI drift check regenerating `docs/l2-benchmarks/data/` from committed results

### Changed

- Issuance-batch latency measured with N≥30 samples per size (was N=1); σ now reported
- Revocation burst uses uniformly-random leaf selection (was deterministic first 30)
- Multi-run pipeline (default 3 runs) for cross-run variance characterization

### Security

- `BENCH_PK` no longer appears in process argv during deploy (`execFileSync` with arg array)
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs: changelog entry for Phase 2 final"
```

## Task A.4: Add benchmarks-drift CI workflow

**Files:**
- Create: `.github/workflows/benchmarks-drift.yml`
- Create: `packages/benchmarks/tests/fixtures/results.fixture.json` (canonical reference results for CI)

- [ ] **Step 1: Identify a canonical results file**

The CI must not call any RPC. Copy the current `benchmarks/results/*.json` (latest committed run) into the test fixture so CI can regenerate tables from a stable input:

```bash
ls benchmarks/results/*.json
# pick the newest non-partial file, e.g. 20260513T093200-abcd.json
cp benchmarks/results/<LATEST>.json packages/benchmarks/tests/fixtures/results.fixture.json
```

- [ ] **Step 2: Add a fixture price-history file**

```bash
ls benchmarks/price-history/*.json
cp benchmarks/price-history/<LATEST>.json packages/benchmarks/tests/fixtures/prices.fixture.json
```

- [ ] **Step 3: Write the workflow**

Create `.github/workflows/benchmarks-drift.yml`:

```yaml
name: Benchmarks drift

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
    paths:
      - 'packages/benchmarks/**'
      - 'docs/l2-benchmarks/data/**'
      - '.github/workflows/benchmarks-drift.yml'

jobs:
  drift:
    name: Regenerate tables and diff
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm

      - run: npm install
      - run: npm -w @univerify/verifier-core run build
      - run: npm -w @univerify/benchmarks run build

      - name: Regenerate data/ from committed fixtures
        run: |
          npm -w @univerify/benchmarks run start -- export \
            --results=packages/benchmarks/tests/fixtures/results.fixture.json \
            --prices=packages/benchmarks/tests/fixtures/prices.fixture.json

      - name: Verify no drift in docs/l2-benchmarks/data/
        run: |
          # measured-at.tex contains a wall clock timestamp; ignore it.
          # meta.json embeds runId + measuredAt; ignore those two fields only.
          git diff --exit-code -- \
            ':(exclude)docs/l2-benchmarks/data/measured-at.tex' \
            ':(exclude)docs/l2-benchmarks/data/meta.json' \
            docs/l2-benchmarks/data/
```

- [ ] **Step 4: Verify locally**

```bash
npm -w @univerify/benchmarks run build
npm -w @univerify/benchmarks run start -- export \
  --results=packages/benchmarks/tests/fixtures/results.fixture.json \
  --prices=packages/benchmarks/tests/fixtures/prices.fixture.json
git status docs/l2-benchmarks/data/
```

Expected: `measured-at.tex` and possibly `meta.json` modified (timestamp + path); everything else unchanged. If other files differ, the fixtures and the committed `docs/l2-benchmarks/data/` are out of sync — regenerate the committed data from the fixture first (`git checkout docs/l2-benchmarks/data/` then run the export and commit the result).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/benchmarks-drift.yml packages/benchmarks/tests/fixtures/
# (re-export if needed) git add docs/l2-benchmarks/data/
git commit -m "ci(benchmarks): regenerate data tables from fixtures and fail on drift"
```

---

# Phase B — Code robustness & opsec

Goal: Eliminate the GitHub-visible footguns (key in argv, dropped-tx hangs, non-atomic writes) and tighten the data model so Phase 3 can reuse the scaffolding.

## Task B.1: Opsec — remove `BENCH_PK` from argv

**Files:**
- Modify: `packages/benchmarks/src/stages/deploy.ts:24`

- [ ] **Step 1: Replace `execSync` with `execFileSync`**

Edit the import at line 4 of `packages/benchmarks/src/stages/deploy.ts`:

```ts
import { execFileSync } from "node:child_process";
```

Replace lines 24-27 (the `execSync(...)` block) with:

```ts
  execFileSync(
    "forge",
    [
      "script",
      "script/Deploy.s.sol:Deploy",
      "--rpc-url", rpcUrl,
      "--private-key", pk,
      "--broadcast",
    ],
    { cwd: path.resolve("contracts"), stdio: "inherit", env: process.env }
  );
```

Note: `execFileSync` with an arg array does NOT spawn a shell, so the private key is passed to the `forge` binary's `argv` but never appears in the parent shell's command line, history, or in `ps aux` output for other users in the same context. The key only lives inside the child process. A stronger alternative — passing via env var — is rejected because `forge script` does not natively read `PRIVATE_KEY` from env without source code changes that we don't control.

If `forge` itself logs the private key in verbose mode, that is upstream. The improvement here is real: it removes the leak via the shell layer and `ps aux` of the parent process.

- [ ] **Step 2: Build**

```bash
npm -w @univerify/benchmarks run build
```

Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/stages/deploy.ts
git commit -m "security(benchmarks): pass BENCH_PK via execFileSync arg array (no shell layer)"
```

## Task B.2: Nonce manager with retry and gas bump

**Files:**
- Create: `packages/benchmarks/src/util/nonceManager.ts`
- Create: `packages/benchmarks/tests/util/nonceManager.test.ts`
- Modify: `packages/benchmarks/src/ops/issueBatch.ts`
- Modify: `packages/benchmarks/src/ops/revokeBatch.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/util/nonceManager.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { sendWithRetry } from "../../src/util/nonceManager.js";

function makeMockClient(opts: {
  failFirstReceipt?: boolean;
  txHashes?: `0x${string}`[];
}) {
  const txHashes = opts.txHashes ?? ["0xaaa" as `0x${string}`, "0xbbb" as `0x${string}`];
  let sendCount = 0;
  let waitCount = 0;
  return {
    sendCount: () => sendCount,
    waitCount: () => waitCount,
    sendTransaction: vi.fn(async () => {
      const hash = txHashes[sendCount];
      sendCount++;
      return hash;
    }),
    waitForTransactionReceipt: vi.fn(async () => {
      waitCount++;
      if (opts.failFirstReceipt && waitCount === 1) {
        throw new Error("timeout waiting for receipt");
      }
      return { blockNumber: 100n, gasUsed: 21000n };
    }),
  };
}

describe("sendWithRetry", () => {
  it("returns the receipt on first-try success", async () => {
    const client = makeMockClient({});
    const result = await sendWithRetry({
      client: client as any,
      send: () => client.sendTransaction(),
      timeoutMs: 1000,
      maxAttempts: 3,
      bumpFactor: 1.25,
    });
    expect(result.blockNumber).toBe(100n);
    expect(client.sendCount()).toBe(1);
  });

  it("retries with a bumped gas price after a receipt timeout", async () => {
    const client = makeMockClient({ failFirstReceipt: true });
    const result = await sendWithRetry({
      client: client as any,
      send: () => client.sendTransaction(),
      timeoutMs: 50,
      maxAttempts: 3,
      bumpFactor: 1.25,
    });
    expect(result.blockNumber).toBe(100n);
    expect(client.sendCount()).toBe(2);
  });

  it("gives up after maxAttempts and throws", async () => {
    const client = {
      sendTransaction: vi.fn(async () => "0xaaa" as `0x${string}`),
      waitForTransactionReceipt: vi.fn(async () => {
        throw new Error("timeout");
      }),
    };
    await expect(
      sendWithRetry({
        client: client as any,
        send: () => client.sendTransaction(),
        timeoutMs: 50,
        maxAttempts: 2,
        bumpFactor: 1.25,
      })
    ).rejects.toThrow(/gave up after 2 attempts/);
    expect(client.sendTransaction).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm -w @univerify/benchmarks test -- nonceManager
```

Expected: FAIL with "Cannot find module '../../src/util/nonceManager.js'" or similar import error.

- [ ] **Step 3: Implement `nonceManager.ts`**

Create `packages/benchmarks/src/util/nonceManager.ts`:

```ts
// packages/benchmarks/src/util/nonceManager.ts
import type { Hex } from "viem";

export type SendWithRetryOpts<TReceipt> = {
  client: {
    waitForTransactionReceipt: (args: { hash: Hex; timeout: number }) => Promise<TReceipt>;
  };
  /**
   * Submits the transaction. Called once per attempt. The implementation is
   * responsible for bumping its own gas price using `attempt` (1-indexed) and
   * the configured `bumpFactor` — exposing the bump here keeps this util
   * type-agnostic to viem's fee fields (EIP-1559 vs legacy).
   */
  send: (attempt: number, bumpFactor: number) => Promise<Hex>;
  timeoutMs: number;
  maxAttempts: number;
  bumpFactor: number;
};

/**
 * Submit a tx, await its receipt, and retry with a bumped gas price if the
 * receipt does not arrive within `timeoutMs`. Bounded by `maxAttempts`.
 *
 * Why this exists: viem auto-nonce + naive `waitForTransactionReceipt` hangs
 * for the full timeout (5 min) when a tx is dropped from the mempool, which
 * kills the whole chain run. This wrapper resends with a higher fee so the
 * replacement tx lands.
 */
export async function sendWithRetry<TReceipt>(
  opts: SendWithRetryOpts<TReceipt>
): Promise<TReceipt> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
    const hash = await opts.send(attempt, opts.bumpFactor);
    try {
      return await opts.client.waitForTransactionReceipt({
        hash,
        timeout: opts.timeoutMs,
      });
    } catch (err) {
      lastError = err;
      if (attempt < opts.maxAttempts) {
        console.warn(
          `[nonceManager] receipt timeout on attempt ${attempt}/${opts.maxAttempts}, bumping and retrying`
        );
      }
    }
  }
  throw new Error(
    `sendWithRetry: gave up after ${opts.maxAttempts} attempts. Last error: ${String(lastError)}`
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm -w @univerify/benchmarks test -- nonceManager
```

Expected: 3 tests pass.

- [ ] **Step 5: Integrate into `issueBatch.ts`**

In `packages/benchmarks/src/ops/issueBatch.ts`, replace the `sendTransaction` block at lines 65-71 with a `sendWithRetry` call. Add at the top:

```ts
import { sendWithRetry } from "../util/nonceManager.js";
import { RECEIPT_TIMEOUT_MS } from "../config.js";
```

Replace the `await adapter.walletClient.sendTransaction({ ... })` (lines 66-71) and the surrounding logic with a structure that uses `sendWithRetry`. Since `adapter.parseReceipt` currently fetches the receipt itself (we need to verify the adapter's `parseReceipt` signature — see `packages/benchmarks/src/chains/types.ts`), the minimum change is to wrap `sendTransaction` so the dropped-tx case is handled.

The cleanest integration: keep `parseReceipt` as-is, but use a small inline helper that awaits receipt with retry, then passes the resulting `txHash` to `parseReceipt`.

Replace lines 65-71 with:

```ts
  const submittedAt = now();
  let currentTxHash: Hex | undefined;
  await sendWithRetry({
    client: adapter.publicClient,
    send: async (attempt, bumpFactor) => {
      // First attempt: normal send. Subsequent attempts: viem will reuse the
      // pending nonce and bump fees if a higher-priced replacement is sent.
      const hash = await adapter.walletClient.sendTransaction({
        to: adapter.registryAddress,
        data: calldata,
        account: adapter.walletClient.account!,
        chain: adapter.walletClient.chain!,
        // For attempts > 1, ask viem to bump maxFeePerGas via gasPrice override
        ...(attempt > 1
          ? { gasPrice: await bumpedGasPrice(adapter, bumpFactor ** (attempt - 1)) }
          : {}),
      });
      currentTxHash = hash;
      return hash;
    },
    timeoutMs: RECEIPT_TIMEOUT_MS,
    maxAttempts: 3,
    bumpFactor: 1.25,
  });
  const txHash = currentTxHash!;
```

Add the helper at the bottom of `issueBatch.ts`:

```ts
async function bumpedGasPrice(adapter: ChainAdapter, multiplier: number): Promise<bigint> {
  const base = await adapter.publicClient.getGasPrice();
  return (base * BigInt(Math.floor(multiplier * 100))) / 100n;
}
```

Note: `RECEIPT_TIMEOUT_MS` is currently 5 minutes. For the retry path we want a shorter per-attempt timeout — change `RECEIPT_TIMEOUT_MS` semantics? No — keep it as the hard ceiling and use 90 s per attempt. Update the `sendWithRetry` call to use `timeoutMs: 90_000` and add an inline comment explaining why.

- [ ] **Step 6: Integrate into `revokeBatch.ts`**

Apply the same pattern in `packages/benchmarks/src/ops/revokeBatch.ts` (lines 51-58). The structure is identical.

- [ ] **Step 7: Run all benchmark tests**

```bash
npm -w @univerify/benchmarks test
```

Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add packages/benchmarks/src/util/nonceManager.ts packages/benchmarks/tests/util/nonceManager.test.ts packages/benchmarks/src/ops/issueBatch.ts packages/benchmarks/src/ops/revokeBatch.ts
git commit -m "feat(benchmarks): nonce manager with gas-bump retry survives dropped txs"
```

## Task B.3: Atomic partial-file write + SIGINT handler

**Files:**
- Modify: `packages/benchmarks/src/stages/measure.ts:129`
- Modify: `packages/benchmarks/src/stages/measure.ts` (top — SIGINT handler)
- Create: `packages/benchmarks/tests/stages/measure.atomic.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/stages/measure.atomic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { atomicWriteJson } from "../../src/util/atomicWrite.js";

describe("atomicWriteJson", () => {
  it("writes the final file via .tmp+rename", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const target = path.join(dir, "out.json");
    atomicWriteJson(target, { hello: "world" });
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ hello: "world" });
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("does not leave a corrupted file if the JSON write throws", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const target = path.join(dir, "out.json");
    fs.writeFileSync(target, '{"old": true}');
    const bad = { circular: {} as any };
    bad.circular.self = bad;
    expect(() => atomicWriteJson(target, bad)).toThrow();
    // Original file untouched:
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ old: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm -w @univerify/benchmarks test -- atomic
```

Expected: FAIL with import error on `atomicWrite.js`.

- [ ] **Step 3: Implement `atomicWrite.ts`**

Create `packages/benchmarks/src/util/atomicWrite.ts`:

```ts
// packages/benchmarks/src/util/atomicWrite.ts
import fs from "node:fs";

/**
 * Write JSON atomically: serialize → write to `${target}.tmp` → rename to
 * `target`. A SIGINT or crash mid-write cannot leave `target` in a partially
 * written state because `rename` is atomic on POSIX. If serialization throws,
 * the target is left untouched.
 */
export function atomicWriteJson(target: string, obj: unknown): void {
  const payload = JSON.stringify(
    obj,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, target);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm -w @univerify/benchmarks test -- atomic
```

Expected: 2 tests pass.

- [ ] **Step 5: Replace direct `writeFileSync` in `measure.ts`**

In `packages/benchmarks/src/stages/measure.ts`:

1. Add at the top with the other imports:

```ts
import { atomicWriteJson } from "../util/atomicWrite.js";
```

2. Replace line 129 (`fs.writeFileSync(partialPath, stringify(run));`) with:

```ts
    atomicWriteJson(partialPath, run);
```

3. Replace line 133 (`fs.writeFileSync(finalPath, stringify(run));`) with:

```ts
  atomicWriteJson(finalPath, run);
```

4. The local `stringify` function (lines 139-145) is now unused if no other caller exists. Remove it.

- [ ] **Step 6: Add SIGINT handler**

In `packages/benchmarks/src/stages/measure.ts`, inside `stageMeasure` after the `partialPath` is determined (around line 68), add:

```ts
  const onInterrupt = () => {
    console.log(`\n[measure] interrupted — partial state preserved at ${partialPath}`);
    process.exit(130);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);
```

And register cleanup right before returning `finalPath`:

```ts
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
```

- [ ] **Step 7: Build and test**

```bash
npm -w @univerify/benchmarks run build
npm -w @univerify/benchmarks test
```

Expected: clean build, all tests pass.

- [ ] **Step 8: Commit**

```bash
git add packages/benchmarks/src/util/atomicWrite.ts packages/benchmarks/tests/stages/measure.atomic.test.ts packages/benchmarks/src/stages/measure.ts
git commit -m "feat(benchmarks): atomic partial-file write and SIGINT-safe resume"
```

## Task B.4: Per-(chain, op, batchSize) resume schema

**Files:**
- Modify: `packages/benchmarks/src/stages/measure.ts`
- Modify: `packages/benchmarks/src/stages/export.ts` (consumers of `RunResults` — verify still compatible)
- Modify: `packages/benchmarks/src/stages/aggregate.ts` (will be created in Task C.5 — postpone consumer changes there)

The existing `RunResults` schema is `{ chains: { [chain]: { issueBatch[], revokeFromBatch[], readLatency[] } } }`. The per-chain check at `measure.ts:75-78` skips the whole chain if any data exists.

**Decision:** the externally visible `RunResults` schema stays the same so `stages/export.ts` and committed JSON files are unaffected. We only enrich the **partial** schema with progress markers that `measure` itself reads on resume.

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/stages/measure.resume.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  resumeNeedsOp,
  type ResumeProgress,
} from "../../src/stages/measureResume.js";

describe("resumeNeedsOp", () => {
  const empty: ResumeProgress = {};

  it("returns true when nothing is recorded", () => {
    expect(resumeNeedsOp(empty, "sepolia", "issueBatch", 100)).toBe(true);
  });

  it("returns false when (chain, op, size) is marked complete", () => {
    const prog: ResumeProgress = {
      sepolia: { issueBatch: { 100: "complete" } },
    };
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 100)).toBe(false);
  });

  it("returns true when a sibling size is complete but ours is not", () => {
    const prog: ResumeProgress = {
      sepolia: { issueBatch: { 100: "complete" } },
    };
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 1000)).toBe(true);
  });

  it("returns true when a different op is complete on the same chain", () => {
    const prog: ResumeProgress = {
      sepolia: { revokeBurst: "complete" },
    };
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 100)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm -w @univerify/benchmarks test -- measure.resume
```

Expected: FAIL with module-not-found.

- [ ] **Step 3: Create the helper module**

Create `packages/benchmarks/src/stages/measureResume.ts`:

```ts
// packages/benchmarks/src/stages/measureResume.ts
import type { ChainKey } from "../config.js";

export type OpKind = "issueBatch" | "revokeBurst" | "readLatency";

export type ResumeProgress = Partial<
  Record<
    ChainKey,
    {
      issueBatch?: Record<number, "complete">;
      revokeBurst?: "complete";
      readLatency?: "complete";
    }
  >
>;

export function resumeNeedsOp(
  prog: ResumeProgress,
  chain: ChainKey,
  op: OpKind,
  size?: number
): boolean {
  const c = prog[chain];
  if (!c) return true;
  if (op === "issueBatch") {
    if (size === undefined) throw new Error("issueBatch requires size");
    return c.issueBatch?.[size] !== "complete";
  }
  return c[op] !== "complete";
}

export function markComplete(
  prog: ResumeProgress,
  chain: ChainKey,
  op: OpKind,
  size?: number
): void {
  const c = (prog[chain] ??= {});
  if (op === "issueBatch") {
    if (size === undefined) throw new Error("issueBatch requires size");
    (c.issueBatch ??= {})[size] = "complete";
  } else {
    (c as any)[op] = "complete";
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm -w @univerify/benchmarks test -- measure.resume
```

Expected: 4 tests pass.

- [ ] **Step 5: Integrate into `measure.ts`**

Refactor `stageMeasure` (`packages/benchmarks/src/stages/measure.ts`) to:

1. Extend the persisted partial JSON with a `progress: ResumeProgress` field alongside the existing `chains`. The final (non-partial) JSON drops the field to keep the on-disk schema unchanged.
2. Replace the per-chain skip at lines 75-78 with per-op checks using `resumeNeedsOp`.
3. After each op completes, call `markComplete` and `atomicWriteJson(partialPath, run)`.

Add imports:

```ts
import { resumeNeedsOp, markComplete, type ResumeProgress } from "./measureResume.js";
```

Extend the `run` shape (in-memory only):

```ts
  const run: RunResults & { progress?: ResumeProgress } = fs.existsSync(partialPath)
    ? (JSON.parse(fs.readFileSync(partialPath, "utf8")) as RunResults & { progress?: ResumeProgress })
    : { runId, measuredAt: new Date().toISOString(), chains: {}, progress: {} };
  const progress: ResumeProgress = run.progress ??= {};
```

Replace the per-chain loop body (`for (const key of keys) { … }`) — instead of an early `continue` when `run.chains[key]` exists, initialize the per-chain bucket lazily and check each op:

```ts
  for (const key of keys) {
    const adapter = getAdapter(key, account);
    await checkBalance(adapter, key);

    const perChain: PerChainResults =
      run.chains[key] ?? { issueBatch: [], revokeFromBatch: [], readLatency: [] };
    run.chains[key] = perChain;

    let nextId = await nextBatchId(adapter);

    for (const size of BATCH_SIZES) {
      if (!resumeNeedsOp(progress, key, "issueBatch", size)) {
        // Skip — already recorded.
        nextId += 1n;
        continue;
      }
      console.log(`[measure] ${key} issueBatch(${size}) batchId=${nextId}`);
      const m = await runIssueBatch(adapter, size, { tag: "main", nextBatchId: nextId });
      perChain.issueBatch.push(m);
      nextId += 1n;
      markComplete(progress, key, "issueBatch", size);
      atomicWriteJson(partialPath, run);
    }

    if (resumeNeedsOp(progress, key, "revokeBurst")) {
      console.log(`[measure] ${key} revoke burst (seed batchId=${nextId})`);
      const burst = await runRevokeBurst(adapter, nextId);
      perChain.issueBatch.push(burst.seed);
      perChain.revokeFromBatch.push(...burst.revokes);
      const seedBatchId = nextId;
      nextId += 1n;

      // read latency uses the seed batch we just issued, so it shares this branch
      const issuer = adapter.walletClient.account!.address;
      const seedDocHashes = makeSyntheticDocHashes(
        SEED_BATCH_SIZE,
        batchSeed(adapter, seedBatchId)
      );
      const seedLeaves = computeBatchLeaves({
        registry: adapter.registryAddress,
        chainId: BigInt(adapter.chainId),
        issuer,
        batchId: seedBatchId,
        docHashes: seedDocHashes,
      });
      const tree = buildMerkleFromLeaves(seedLeaves);
      console.log(`[measure] ${key} read latency (N samples)`);
      const reads = await runReadLatency(adapter, {
        batchId: seedBatchId,
        docHash: seedDocHashes[0],
        proof: tree.proofs[0],
        issuer,
      });
      perChain.readLatency = reads;

      markComplete(progress, key, "revokeBurst");
      markComplete(progress, key, "readLatency");
      atomicWriteJson(partialPath, run);
    }
  }
```

Before promoting partial → final, strip `progress`:

```ts
  delete (run as { progress?: ResumeProgress }).progress;
  atomicWriteJson(finalPath, run);
  fs.unlinkSync(partialPath);
```

- [ ] **Step 6: Run tests**

```bash
npm -w @univerify/benchmarks test
```

Expected: all green. `export.test.ts` continues to pass because the final-JSON schema is unchanged.

- [ ] **Step 7: Build**

```bash
npm -w @univerify/benchmarks run build
```

Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/benchmarks/src/stages/measureResume.ts packages/benchmarks/tests/stages/measure.resume.test.ts packages/benchmarks/src/stages/measure.ts
git commit -m "feat(benchmarks): per-(chain,op,batchSize) resume with progress tracking"
```

## Task B.5: Binary-search `nextBatchId`

**Files:**
- Modify: `packages/benchmarks/src/stages/measure.ts:43-57`
- Create: `packages/benchmarks/tests/stages/measure.nextBatchId.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/stages/measure.nextBatchId.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { findNextBatchId } from "../../src/stages/nextBatchId.js";

const ZERO = "0x0000000000000000000000000000000000000000000000000000000000000000";
const NONZERO = "0xabcdef00000000000000000000000000000000000000000000000000000000000000";

function makeReader(occupied: bigint): (id: bigint) => Promise<`0x${string}`> {
  return async (id) => (id < occupied ? (NONZERO as `0x${string}`) : (ZERO as `0x${string}`));
}

describe("findNextBatchId", () => {
  it("returns 0 when no batches exist", async () => {
    expect(await findNextBatchId(makeReader(0n))).toBe(0n);
  });

  it("returns 1 when only batch 0 exists", async () => {
    expect(await findNextBatchId(makeReader(1n))).toBe(1n);
  });

  it("returns 17 when batches 0..16 exist", async () => {
    expect(await findNextBatchId(makeReader(17n))).toBe(17n);
  });

  it("returns 1024 when batches 0..1023 exist (exact power of two)", async () => {
    expect(await findNextBatchId(makeReader(1024n))).toBe(1024n);
  });

  it("uses O(log n) reads", async () => {
    let calls = 0;
    const reader = async (id: bigint): Promise<`0x${string}`> => {
      calls++;
      return id < 1_000_000n ? (NONZERO as `0x${string}`) : (ZERO as `0x${string}`);
    };
    const result = await findNextBatchId(reader);
    expect(result).toBe(1_000_000n);
    // Doubling-then-binary-search is bounded by ~2*ceil(log2(n)). Allow some slack.
    expect(calls).toBeLessThan(60);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm -w @univerify/benchmarks test -- nextBatchId
```

Expected: module-not-found error.

- [ ] **Step 3: Implement `nextBatchId.ts`**

Create `packages/benchmarks/src/stages/nextBatchId.ts`:

```ts
// packages/benchmarks/src/stages/nextBatchId.ts
import type { Hex } from "viem";

const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

export type BatchReader = (id: bigint) => Promise<Hex>;

/**
 * Find the smallest `batchId` whose root is zero (i.e. the next unused id).
 *
 * Strategy: doubling-then-binary-search.
 *   1. Find an upper bound by doubling from 1 until the reader returns zero.
 *   2. Binary-search the half-open interval [lower, upper).
 *
 * Total reads: O(log n) for n actual batches. The reader is awaited
 * sequentially because RPC providers rate-limit per-key; parallelism would
 * make this slower in practice.
 */
export async function findNextBatchId(read: BatchReader): Promise<bigint> {
  if ((await read(0n)) === ZERO_BYTES32) return 0n;

  let upper = 1n;
  while ((await read(upper)) !== ZERO_BYTES32) {
    upper *= 2n;
  }
  let lower = upper / 2n;

  // Invariant: read(lower) is non-zero, read(upper) is zero. Binary search.
  while (upper - lower > 1n) {
    const mid = (lower + upper) / 2n;
    if ((await read(mid)) === ZERO_BYTES32) {
      upper = mid;
    } else {
      lower = mid;
    }
  }
  return upper;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm -w @univerify/benchmarks test -- nextBatchId
```

Expected: 5 tests pass.

- [ ] **Step 5: Integrate into `measure.ts`**

Replace the existing `nextBatchId` function in `measure.ts` (lines 43-57) with:

```ts
import { findNextBatchId } from "./nextBatchId.js";

async function nextBatchId(adapter: ChainAdapter): Promise<bigint> {
  const issuer = adapter.walletClient.account!.address;
  return findNextBatchId(async (id) =>
    (await adapter.publicClient.readContract({
      address: adapter.registryAddress,
      abi: DiplomaRegistryAbi,
      functionName: "getBatch",
      args: [issuer, id],
    })) as Hex
  );
}
```

The `ZERO_BYTES32` constant at the top of `measure.ts` (lines 28-29) is now unused there — it lives in `nextBatchId.ts`. Remove from `measure.ts`.

- [ ] **Step 6: Build and test**

```bash
npm -w @univerify/benchmarks run build
npm -w @univerify/benchmarks test
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/stages/nextBatchId.ts packages/benchmarks/tests/stages/measure.nextBatchId.test.ts packages/benchmarks/src/stages/measure.ts
git commit -m "perf(benchmarks): binary-search nextBatchId (O(log n) RPC reads)"
```

## Task B.6.1: Exhaustiveness check on `chainName`

**Files:**
- Modify: `packages/benchmarks/src/stages/export.ts`

- [ ] **Step 1: Find the unchecked cast**

`packages/benchmarks/src/stages/export.ts` calls `getCostModel(m.chainName)` (around line 220). Check `packages/benchmarks/src/cost-models/index.ts` — if the registry already throws on unknown chains, the existing call is already safe. The spec calls out an unchecked cast pattern; if `getCostModel` happens to fall back to a default, that's the bug to fix.

Read both files first to confirm where the cast/silent-default actually lives:

```bash
grep -n "ChainKey\|chainName" packages/benchmarks/src/stages/export.ts packages/benchmarks/src/cost-models/index.ts
```

If `cost-models/index.ts` already uses an exhaustive switch with `never` default, document that and move on. Otherwise add the switch there.

- [ ] **Step 2: If the registry lacks exhaustiveness, add it**

In `packages/benchmarks/src/cost-models/index.ts` `getCostModel`, ensure the dispatch ends with:

```ts
    default: {
      const _exhaustive: never = chainName;
      throw new Error(`unknown chainName: ${String(chainName)}`);
    }
```

- [ ] **Step 3: Build**

```bash
npm -w @univerify/benchmarks run build
```

Expected: clean. If the exhaustive check fires, that means a new chain was added without a model — fix.

- [ ] **Step 4: Commit (only if changes made)**

```bash
git add packages/benchmarks/src/cost-models/index.ts
git commit -m "refactor(benchmarks): exhaustiveness check in cost-model dispatch"
```

If no changes were needed because the registry was already exhaustive, skip the commit.

## Task B.6.2: Hex-ness validation in `loadBenchAccount`

**Files:**
- Modify: `packages/benchmarks/src/util/wallet.ts`
- Create: `packages/benchmarks/tests/util/wallet.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/util/wallet.test.ts`:

```ts
import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { loadBenchAccount } from "../../src/util/wallet.js";

const VALID = "0x" + "a".repeat(64);

describe("loadBenchAccount", () => {
  const originalPk = process.env.BENCH_PK;
  beforeEach(() => {
    delete process.env.BENCH_PK;
  });
  afterEach(() => {
    if (originalPk === undefined) delete process.env.BENCH_PK;
    else process.env.BENCH_PK = originalPk;
  });

  it("loads a valid private key", () => {
    process.env.BENCH_PK = VALID;
    const account = loadBenchAccount();
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("rejects missing key", () => {
    expect(() => loadBenchAccount()).toThrow(/BENCH_PK is not set/);
  });

  it("rejects missing 0x prefix", () => {
    process.env.BENCH_PK = "a".repeat(64);
    expect(() => loadBenchAccount()).toThrow(/0x-prefixed/);
  });

  it("rejects wrong length", () => {
    process.env.BENCH_PK = "0x" + "a".repeat(60);
    expect(() => loadBenchAccount()).toThrow(/0x-prefixed/);
  });

  it("rejects non-hex characters", () => {
    process.env.BENCH_PK = "0x" + "z".repeat(64);
    expect(() => loadBenchAccount()).toThrow(/hex/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm -w @univerify/benchmarks test -- wallet
```

Expected: the "non-hex" test fails — currently passes through to viem and throws a different error.

- [ ] **Step 3: Tighten the validator**

Edit `packages/benchmarks/src/util/wallet.ts`:

```ts
// packages/benchmarks/src/util/wallet.ts
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

const PK_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export function loadBenchAccount(): PrivateKeyAccount {
  const pk = process.env.BENCH_PK;
  if (!pk) {
    throw new Error(
      "BENCH_PK is not set. Export a funded testnet private key with a 0x prefix."
    );
  }
  if (!pk.startsWith("0x") || pk.length !== 66) {
    throw new Error("BENCH_PK must be a 0x-prefixed 32-byte hex private key.");
  }
  if (!PK_PATTERN.test(pk)) {
    throw new Error("BENCH_PK contains non-hex characters.");
  }
  return privateKeyToAccount(pk as `0x${string}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm -w @univerify/benchmarks test -- wallet
```

Expected: 5 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/util/wallet.ts packages/benchmarks/tests/util/wallet.test.ts
git commit -m "fix(benchmarks): validate BENCH_PK is hex (not just 0x + 64 chars)"
```

## Task B.6.3: Project-relative path in `Deploy.s.sol`

**Files:**
- Modify: `contracts/script/Deploy.s.sol`

- [ ] **Step 1: Replace relative path with project root**

In `contracts/script/Deploy.s.sol`, lines 24-28 currently build a path relative to forge's `cwd` (`deployments/<id>.json`). The `stages/deploy.ts` step `cd`s into `contracts/` so it works, but if someone runs forge directly from the repo root they get a `contracts/deployments/...` path elsewhere. Use `vm.projectRoot()` so the path is stable regardless of cwd.

Replace lines 24-28:

```solidity
        string memory path = string.concat(
            vm.projectRoot(),
            "/deployments/",
            vm.toString(chainId),
            ".json"
        );
```

- [ ] **Step 2: Build contracts**

```bash
cd contracts && forge build
```

Expected: clean. (`vm.projectRoot()` exists in modern forge-std.)

- [ ] **Step 3: Run Solidity tests**

```bash
cd contracts && forge test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add contracts/script/Deploy.s.sol
git commit -m "fix(contracts): write deployment JSON to project-root-relative path"
```

## Task B.6.4: Clock-source policy comment

**Files:**
- Modify: `packages/benchmarks/src/util/timing.ts`

- [ ] **Step 1: Document the policy**

Add at the top of `packages/benchmarks/src/util/timing.ts`, replacing the current `now` JSDoc with:

```ts
// packages/benchmarks/src/util/timing.ts

/**
 * Clock-source policy for this package:
 *
 *   - `performance.now()` (this module) — for ALL latency measurements
 *     (`submittedAt`, `includedAt`, RPC read timings). Monotonic; safe to diff;
 *     NOT comparable to wall-clock or `Date.now()`.
 *
 *   - `Date.now()` / `new Date()` — reserved for externally-meaningful
 *     timestamps that are stored to disk or reported to the user (e.g.
 *     `RunResults.measuredAt`, `ReadLatencySample.sampledAt`). These are
 *     wall-clock and may jump under NTP adjustment; never subtract two of
 *     them to measure an interval.
 *
 * When in doubt: a duration uses `performance.now()`; a timestamp uses
 * `Date.now()`.
 */
export function now(): number {
  return performance.now();
}
```

(The rest of the file stays as-is.)

- [ ] **Step 2: Sanity-check usage**

```bash
grep -n "Date.now\|performance.now" packages/benchmarks/src/
```

Expected: every `Date.now()` is inside a code path that produces an `*At` external timestamp; every `performance.now()` (or `now()`) is inside a code path measuring duration. If something is mismatched, fix it before committing.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/util/timing.ts
git commit -m "docs(benchmarks): document clock-source policy for this package"
```

---

# Phase C — Full measurement re-run

Goal: Re-run the pipeline with N=30 latency samples, uniformly random revoke, 3 independent runs through a single RPC POP — eliminating caveats #4, #5, #6, #7 instead of describing them.

## Task C.1: Seeded PRNG utility

**Files:**
- Create: `packages/benchmarks/src/util/prng.ts`
- Create: `packages/benchmarks/tests/util/prng.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/util/prng.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createPrng, sampleWithoutReplacement } from "../../src/util/prng.js";

describe("createPrng", () => {
  it("is deterministic for the same seed", () => {
    const a = createPrng("test-seed");
    const b = createPrng("test-seed");
    expect(a.nextInt(0, 1000)).toBe(b.nextInt(0, 1000));
    expect(a.nextInt(0, 1000)).toBe(b.nextInt(0, 1000));
  });

  it("produces a different sequence for a different seed", () => {
    const a = createPrng("seed-a");
    const b = createPrng("seed-b");
    const xs = Array.from({ length: 10 }, () => a.nextInt(0, 1000));
    const ys = Array.from({ length: 10 }, () => b.nextInt(0, 1000));
    expect(xs).not.toEqual(ys);
  });

  it("nextInt respects bounds", () => {
    const r = createPrng("bounds");
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(5, 10);
      expect(v).toBeGreaterThanOrEqual(5);
      expect(v).toBeLessThan(10);
    }
  });
});

describe("sampleWithoutReplacement", () => {
  it("returns k unique indices in [0, n)", () => {
    const rng = createPrng("sample");
    const out = sampleWithoutReplacement(rng, 100, 30);
    expect(out).toHaveLength(30);
    expect(new Set(out).size).toBe(30);
    for (const i of out) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(100);
    }
  });

  it("is deterministic given the same seed", () => {
    const a = sampleWithoutReplacement(createPrng("x"), 100, 30);
    const b = sampleWithoutReplacement(createPrng("x"), 100, 30);
    expect(a).toEqual(b);
  });

  it("throws when k > n", () => {
    expect(() => sampleWithoutReplacement(createPrng("e"), 5, 10)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm -w @univerify/benchmarks test -- prng
```

Expected: module-not-found.

- [ ] **Step 3: Implement Mulberry32-based PRNG**

Create `packages/benchmarks/src/util/prng.ts`:

```ts
// packages/benchmarks/src/util/prng.ts

/**
 * Seeded PRNG using Mulberry32. Deterministic given the same seed string.
 * Not cryptographically secure — fine for sampling indices.
 */
export type Prng = {
  next: () => number;
  nextInt: (lo: number, hi: number) => number;
};

function hashSeed(seed: string): number {
  // FNV-1a 32-bit
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function createPrng(seed: string): Prng {
  let state = hashSeed(seed);
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const nextInt = (lo: number, hi: number): number => {
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) {
      throw new Error("nextInt: bounds must be integers");
    }
    if (hi <= lo) throw new Error("nextInt: hi must be > lo");
    return lo + Math.floor(next() * (hi - lo));
  };
  return { next, nextInt };
}

/**
 * Uniformly sample `k` distinct integers from `[0, n)` using a reservoir of
 * size `k`. O(k) memory, O(n) time. Fine for n up to ~10^5.
 */
export function sampleWithoutReplacement(rng: Prng, n: number, k: number): number[] {
  if (k > n) throw new Error(`sampleWithoutReplacement: k=${k} > n=${n}`);
  // Floyd's algorithm
  const result = new Set<number>();
  for (let i = n - k; i < n; i++) {
    const j = rng.nextInt(0, i + 1);
    if (result.has(j)) result.add(i);
    else result.add(j);
  }
  return [...result];
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm -w @univerify/benchmarks test -- prng
```

Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/util/prng.ts packages/benchmarks/tests/util/prng.test.ts
git commit -m "feat(benchmarks): seeded PRNG and uniform without-replacement sampling"
```

## Task C.2: Randomize revoke leaf selection

**Files:**
- Modify: `packages/benchmarks/src/config.ts`
- Modify: `packages/benchmarks/src/ops/revokeBatch.ts`

- [ ] **Step 1: Add seed config**

In `packages/benchmarks/src/config.ts`, add:

```ts
/**
 * Seed for randomized revoke leaf selection. Default is the literal
 * "univerify-phase-2" so a fresh `git clone` reproduces the committed run;
 * override via `BENCH_RANDOM_SEED` for a perturbation study.
 */
export const BENCH_RANDOM_SEED = process.env.BENCH_RANDOM_SEED ?? "univerify-phase-2";
```

- [ ] **Step 2: Update `runRevokeBurst` to sample random indices**

In `packages/benchmarks/src/ops/revokeBatch.ts`:

Add imports:

```ts
import { BENCH_RANDOM_SEED, REVOKE_N, SEED_BATCH_SIZE } from "../config.js";
import { createPrng, sampleWithoutReplacement } from "../util/prng.js";
```

Replace lines 41-64 (the `for (let i = 0; i < REVOKE_N; i++) { … }` loop) with:

```ts
  // Uniformly sample REVOKE_N distinct indices from [0, SEED_BATCH_SIZE).
  // Per-chain seed prefix keeps cross-chain runs independent.
  const rng = createPrng(`${BENCH_RANDOM_SEED}:${adapter.name}:${nextBatchId.toString()}`);
  const indices = sampleWithoutReplacement(rng, SEED_BATCH_SIZE, REVOKE_N);

  const revokes: NormalizedMetrics[] = [];
  for (const i of indices) {
    const docHash = docHashes[i];
    const proof = tree.proofs[i];
    const calldata = encodeFunctionData({
      abi: DiplomaRegistryAbi,
      functionName: "revokeFromBatch",
      args: [docHash, nextBatchId, proof],
    });

    const submittedAt = now();
    // (Same sendWithRetry block as Task B.2 — keep that integration intact.)
    const txHash = await adapter.walletClient.sendTransaction({
      to: adapter.registryAddress,
      data: calldata,
      account: adapter.walletClient.account!,
      chain: adapter.walletClient.chain!,
    });

    const metrics = await adapter.parseReceipt(
      { txHash, calldata, submittedAt },
      "revokeFromBatch"
    );
    revokes.push(metrics);
  }
```

Note: the `sendTransaction` block above is shorthand — keep whatever `sendWithRetry` integration was put in place in Task B.2. The key change vs. before is the `indices` array driving the loop.

- [ ] **Step 3: Build and existing tests**

```bash
npm -w @univerify/benchmarks run build
npm -w @univerify/benchmarks test
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/benchmarks/src/config.ts packages/benchmarks/src/ops/revokeBatch.ts
git commit -m "feat(benchmarks): randomize revoke leaf selection (eliminates caveat #6)"
```

## Task C.3: N=30 latency samples for issueBatch

**Files:**
- Modify: `packages/benchmarks/src/config.ts`
- Modify: `packages/benchmarks/src/ops/issueBatch.ts`
- Modify: `packages/benchmarks/src/chains/types.ts` — extend `NormalizedMetrics` to carry repeated latency samples
- Modify: `packages/benchmarks/src/stages/export.ts` — read new latency field
- Modify: `packages/benchmarks/tests/stages/export.test.ts` — update fixtures

**Note on scope:** Gas for `issueBatch` is deterministic given inputs, so we still issue **one** batch per size and gas is reported once. What we add is *additional latency-only measurements* by issuing N-1 extra batches per size at the same `batchSize` (consuming extra `batchId`s), recording only their submission→inclusion latency.

- [ ] **Step 1: Add config knob**

In `packages/benchmarks/src/config.ts`:

```ts
/**
 * Latency-only repetitions per issueBatch size. Each repetition consumes a
 * fresh batchId. N>=30 lets us report p50/p95/σ instead of a single sample.
 * Gas is deterministic per (size, code) so it's reported once; only timing
 * is sampled multiple times.
 */
export const ISSUE_LATENCY_REPS = 30;
```

- [ ] **Step 2: Extend `NormalizedMetrics`**

In `packages/benchmarks/src/chains/types.ts`, add an optional field:

```ts
/** Additional inclusion-latency samples (ms) for this size, beyond the primary measurement. Phase C addition. */
latencySamplesMs?: number[];
```

Place it next to the existing latency field. Build to surface any type errors:

```bash
npm -w @univerify/benchmarks run build
```

- [ ] **Step 3: Issue extra latency-only batches in `runIssueBatch` callers**

Don't change `runIssueBatch`'s signature — instead, in `stages/measure.ts`, after the primary call for each size, run `ISSUE_LATENCY_REPS - 1` extra issuances and gather `inclusionLatencyMs` into the primary metric's `latencySamplesMs` array. This keeps `ops/issueBatch.ts` orthogonal.

In `packages/benchmarks/src/stages/measure.ts`, replace the body of the `for (const size of BATCH_SIZES) { … }` loop (inside the `resumeNeedsOp` branch added in Task B.4) with:

```ts
      console.log(`[measure] ${key} issueBatch(${size}) batchId=${nextId} primary`);
      const primary = await runIssueBatch(adapter, size, {
        tag: "main",
        nextBatchId: nextId,
      });
      nextId += 1n;

      const latencySamplesMs: number[] = [primary.inclusionLatencyMs];
      for (let rep = 1; rep < ISSUE_LATENCY_REPS; rep++) {
        console.log(
          `[measure] ${key} issueBatch(${size}) latency rep ${rep + 1}/${ISSUE_LATENCY_REPS} batchId=${nextId}`
        );
        const extra = await runIssueBatch(adapter, size, {
          tag: "main",
          nextBatchId: nextId,
        });
        latencySamplesMs.push(extra.inclusionLatencyMs);
        nextId += 1n;
      }
      primary.latencySamplesMs = latencySamplesMs;
      perChain.issueBatch.push(primary);
      markComplete(progress, key, "issueBatch", size);
      atomicWriteJson(partialPath, run);
```

Import `ISSUE_LATENCY_REPS` at the top of `measure.ts`.

- [ ] **Step 4: Update `stages/export.ts` to consume `latencySamplesMs`**

The inclusion-latency table currently uses `revokeFromBatch` samples for its p50/p95 (lines 160-172 of `export.ts`). The thesis caveat #5 was about `issueBatch` latency. Add a new column source: when a `NormalizedMetrics` for `issueBatch` (size 1000) carries `latencySamplesMs`, the inclusion-latency table should include an `issue_p50_ms` / `issue_p95_ms` / `issue_sigma_ms` set of columns.

Replace `writeInclusionLatencyTable` (`packages/benchmarks/src/stages/export.ts:160-173`) with:

```ts
export function writeInclusionLatencyTable(run: RunResults, outDir: string): string {
  const csvPath = path.join(outDir, "table-inclusion-latency.csv");
  const header = [
    "chain",
    "revoke_p50_ms",
    "revoke_p95_ms",
    "issue_p50_ms",
    "issue_p95_ms",
    "issue_sigma_ms",
    "issue_n",
  ].join(",");
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.revokeFromBatch.length === 0) continue;
    const r = data.revokeFromBatch.map((x) => x.inclusionLatencyMs).sort((a, b) => a - b);
    const pick = (s: number[], p: number) =>
      s[Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length) - 1))];

    const issueMain = data.issueBatch.find((x) => x.tag === "main" && x.batchSize === 1000);
    const issueSamples = (issueMain?.latencySamplesMs ?? []).slice().sort((a, b) => a - b);
    const issueP50 = issueSamples.length ? pick(issueSamples, 0.5).toFixed(0) : "";
    const issueP95 = issueSamples.length ? pick(issueSamples, 0.95).toFixed(0) : "";
    const issueSigma = issueSamples.length
      ? stddev(issueSamples).toFixed(2)
      : "";
    const issueN = issueSamples.length || "";

    rows.push([chain, pick(r, 0.5), pick(r, 0.95), issueP50, issueP95, issueSigma, issueN].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((acc, x) => acc + (x - mean) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(v);
}
```

- [ ] **Step 5: Update existing export test**

`packages/benchmarks/tests/stages/export.test.ts` — add coverage for the new columns. Add a new test alongside existing ones:

```ts
import { writeInclusionLatencyTable } from "../../src/stages/export.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

it("inclusion-latency table reports issue p50/p95/σ from latencySamplesMs", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "export-"));
  const run = {
    runId: "test",
    measuredAt: "2026-05-17T00:00:00Z",
    chains: {
      sepolia: {
        issueBatch: [
          {
            chainName: "sepolia",
            tag: "main",
            batchSize: 1000,
            gasUsed: "0",
            effectiveGasPrice: "0",
            l1DataFee: "0",
            inclusionLatencyMs: 1000,
            latencySamplesMs: [900, 950, 1000, 1050, 1100],
          },
        ],
        revokeFromBatch: [
          { chainName: "sepolia", gasUsed: "0", effectiveGasPrice: "0", l1DataFee: "0", inclusionLatencyMs: 500 },
        ],
        readLatency: [],
      },
    },
  };
  writeInclusionLatencyTable(run as any, dir);
  const csv = fs.readFileSync(path.join(dir, "table-inclusion-latency.csv"), "utf8");
  expect(csv).toContain("issue_sigma_ms");
  expect(csv).toContain("sepolia");
  // 5 samples, p50 of [900,950,1000,1050,1100] @ nearest-rank = 1000
  expect(csv).toMatch(/sepolia,500,500,1000,1100,79.06,5/);
});
```

(Adjust σ value if needed — recompute from the actual formula.)

- [ ] **Step 6: Build and test**

```bash
npm -w @univerify/benchmarks run build
npm -w @univerify/benchmarks test
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/config.ts packages/benchmarks/src/chains/types.ts packages/benchmarks/src/stages/measure.ts packages/benchmarks/src/stages/export.ts packages/benchmarks/tests/stages/export.test.ts
git commit -m "feat(benchmarks): N=30 latency reps for issueBatch with σ in export table"
```

## Task C.4: Pin RPC provider, document single-POP setup

**Files:**
- Modify: `packages/benchmarks/README.md` (Environment section — already added in A.2; reinforce single-POP requirement)
- Modify: `packages/benchmarks/src/config.ts` (add provider/region capture)
- Modify: `packages/benchmarks/src/stages/export.ts` (record provider/region in `meta.json`)

- [ ] **Step 1: Add env knobs for provenance**

In `packages/benchmarks/src/config.ts`:

```ts
/** Optional metadata: RPC provider name and POP/region, recorded in meta.json. */
export const RPC_PROVIDER = process.env.RPC_PROVIDER ?? "unspecified";
export const RPC_REGION = process.env.RPC_REGION ?? "unspecified";
```

- [ ] **Step 2: Record in `meta.json`**

In `packages/benchmarks/src/stages/export.ts`, update `writeMeta` (around line 279):

```ts
import { RPC_PROVIDER, RPC_REGION, BENCH_RANDOM_SEED } from "../config.js";

export function writeMeta(
  run: RunResults,
  pricePath: string,
  outDir: string
): string {
  const outPath = path.join(outDir, "meta.json");
  const meta = {
    runId: run.runId,
    measuredAt: run.measuredAt,
    priceSource: pricePath,
    ethUsd: ETH_USD,
    ethUsdSnapshotDate: ETH_USD_SNAPSHOT_DATE,
    rpcProvider: RPC_PROVIDER,
    rpcRegion: RPC_REGION,
    randomSeed: BENCH_RANDOM_SEED,
    chains: Object.keys(run.chains),
  };
  fs.writeFileSync(outPath, JSON.stringify(meta, null, 2));
  return outPath;
}
```

- [ ] **Step 3: Update README**

Add to the Environment table in `packages/benchmarks/README.md` (from Task A.2):

```markdown
| `RPC_PROVIDER` | (Optional) provider name string, recorded in `meta.json` (e.g., `"alchemy"`) |
| `RPC_REGION` | (Optional) POP/region string, recorded in `meta.json` (e.g., `"us-east-1"`) |
```

- [ ] **Step 4: Build and test**

```bash
npm -w @univerify/benchmarks run build
npm -w @univerify/benchmarks test
```

Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/config.ts packages/benchmarks/src/stages/export.ts packages/benchmarks/README.md
git commit -m "feat(benchmarks): record RPC provider/region and random seed in meta.json"
```

## Task C.5: Multi-run support — `--runs=N` writes to `run-N/` subdirs

**Files:**
- Modify: `packages/benchmarks/src/stages/measure.ts` — accept `runLabel`
- Modify: `packages/benchmarks/src/index.ts` — pass runLabel through `all`

- [ ] **Step 1: Add `runLabel` parameter to `stageMeasure`**

In `packages/benchmarks/src/stages/measure.ts`:

```ts
export type MeasureOpts = { only?: ChainKey; resume?: string; runLabel?: string };
```

In the function body, parameterize `RESULTS_DIR`:

```ts
  const resultsDir = opts.runLabel
    ? path.resolve("benchmarks", "results", opts.runLabel)
    : path.resolve("benchmarks", "results");
  fs.mkdirSync(resultsDir, { recursive: true });
  // ... use resultsDir in place of RESULTS_DIR for partialPath / finalPath
```

Replace the existing `RESULTS_DIR` constant with the local `resultsDir` everywhere in this function.

- [ ] **Step 2: Wire through in `index.ts`**

In `packages/benchmarks/src/index.ts` `all` case (which Task A.1 left without runLabel), restore the multi-run path:

```ts
    case "all": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      const runs = Number(argValue(rest, "runs") ?? "1");
      if (!Number.isInteger(runs) || runs < 1) {
        throw new Error(`--runs must be a positive integer, got ${runs}`);
      }
      await stageDeploy(only);
      for (let r = 1; r <= runs; r++) {
        if (runs > 1) console.log(`[all] run ${r}/${runs}`);
        await stageMeasure({
          only,
          runLabel: runs > 1 ? `run-${r}` : undefined,
        });
      }
      await stagePrice();
      if (runs > 1) {
        // Aggregation handled in next task — for now, error early so the
        // operator knows they need to run the aggregate stage manually.
        console.log(`[all] runs=${runs}: run 'benchmarks aggregate' before export.`);
        return;
      }
      stageExport({});
      return;
    }
```

- [ ] **Step 3: Build**

```bash
npm -w @univerify/benchmarks run build
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add packages/benchmarks/src/stages/measure.ts packages/benchmarks/src/index.ts
git commit -m "feat(benchmarks): multi-run output to benchmarks/results/run-N/ subdirs"
```

## Task C.6: Aggregate stage — merge 3 runs into final tables

**Files:**
- Create: `packages/benchmarks/src/stages/aggregate.ts`
- Create: `packages/benchmarks/tests/stages/aggregate.test.ts`
- Modify: `packages/benchmarks/src/index.ts` — add `aggregate` command, wire into `all` when `runs > 1`

- [ ] **Step 1: Write the failing test**

Create `packages/benchmarks/tests/stages/aggregate.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { aggregateRuns } from "../../src/stages/aggregate.js";

function writeRun(dir: string, label: string, chains: any): string {
  const sub = path.join(dir, label);
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, "test.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ runId: label, measuredAt: "2026-01-01", chains }, null, 2)
  );
  return file;
}

describe("aggregateRuns", () => {
  it("merges issueBatch latencySamplesMs across runs by (chain, batchSize)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-"));
    writeRun(dir, "run-1", {
      sepolia: {
        issueBatch: [
          { chainName: "sepolia", tag: "main", batchSize: 1000, gasUsed: "100", effectiveGasPrice: "0", l1DataFee: "0", inclusionLatencyMs: 900, latencySamplesMs: [900, 950] },
        ],
        revokeFromBatch: [],
        readLatency: [],
      },
    });
    writeRun(dir, "run-2", {
      sepolia: {
        issueBatch: [
          { chainName: "sepolia", tag: "main", batchSize: 1000, gasUsed: "100", effectiveGasPrice: "0", l1DataFee: "0", inclusionLatencyMs: 1100, latencySamplesMs: [1050, 1100] },
        ],
        revokeFromBatch: [],
        readLatency: [],
      },
    });
    const merged = aggregateRuns([
      path.join(dir, "run-1", "test.json"),
      path.join(dir, "run-2", "test.json"),
    ]);
    const m = merged.chains.sepolia.issueBatch.find(
      (x: any) => x.batchSize === 1000 && x.tag === "main"
    );
    expect(m.latencySamplesMs).toEqual([900, 950, 1050, 1100]);
  });

  it("concatenates revokeFromBatch and readLatency arrays", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-"));
    writeRun(dir, "run-1", {
      sepolia: {
        issueBatch: [],
        revokeFromBatch: [{ inclusionLatencyMs: 100 }],
        readLatency: [{ latencyMs: 50 }],
      },
    });
    writeRun(dir, "run-2", {
      sepolia: {
        issueBatch: [],
        revokeFromBatch: [{ inclusionLatencyMs: 200 }],
        readLatency: [{ latencyMs: 60 }],
      },
    });
    const merged = aggregateRuns([
      path.join(dir, "run-1", "test.json"),
      path.join(dir, "run-2", "test.json"),
    ]);
    expect(merged.chains.sepolia.revokeFromBatch).toHaveLength(2);
    expect(merged.chains.sepolia.readLatency).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm -w @univerify/benchmarks test -- aggregate
```

Expected: module-not-found.

- [ ] **Step 3: Implement `aggregate.ts`**

Create `packages/benchmarks/src/stages/aggregate.ts`:

```ts
// packages/benchmarks/src/stages/aggregate.ts
import fs from "node:fs";
import path from "node:path";
import type { NormalizedMetrics, ReadLatencySample } from "../chains/types.js";
import { atomicWriteJson } from "../util/atomicWrite.js";
import type { PerChainResults, RunResults } from "./export.js";

/**
 * Combine N independent runs into a single `RunResults`:
 *   - `issueBatch[main, size=S]` entries are merged by (chain, size) — `latencySamplesMs` arrays are concatenated; gas/exec metrics taken from the first run (gas is deterministic).
 *   - `issueBatch[tag=seed]` entries are concatenated (one per run).
 *   - `revokeFromBatch` and `readLatency` arrays are concatenated.
 */
export function aggregateRuns(runPaths: string[]): RunResults {
  if (runPaths.length === 0) throw new Error("aggregateRuns: no runs given");
  const runs = runPaths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as RunResults);

  const merged: RunResults = {
    runId: `agg-${runs.map((r) => r.runId).join("+")}`,
    measuredAt: runs[0].measuredAt,
    chains: {},
  };

  const chainNames = new Set<string>();
  for (const r of runs) for (const c of Object.keys(r.chains)) chainNames.add(c);

  for (const chain of chainNames) {
    const out: PerChainResults = {
      issueBatch: [],
      revokeFromBatch: [],
      readLatency: [],
    };

    // issueBatch main: merge by batchSize
    const mainBySize = new Map<number, NormalizedMetrics>();
    for (const r of runs) {
      const c = r.chains[chain];
      if (!c) continue;
      for (const m of c.issueBatch) {
        if (m.tag !== "main" || m.batchSize == null) continue;
        const existing = mainBySize.get(m.batchSize);
        if (!existing) {
          mainBySize.set(m.batchSize, {
            ...m,
            latencySamplesMs: [...(m.latencySamplesMs ?? [m.inclusionLatencyMs])],
          });
        } else {
          existing.latencySamplesMs = [
            ...(existing.latencySamplesMs ?? []),
            ...(m.latencySamplesMs ?? [m.inclusionLatencyMs]),
          ];
        }
      }
    }
    out.issueBatch.push(...mainBySize.values());

    // seed issueBatch entries: keep all
    for (const r of runs) {
      const c = r.chains[chain];
      if (!c) continue;
      for (const m of c.issueBatch) {
        if (m.tag === "seed") out.issueBatch.push(m);
      }
    }

    // revokeFromBatch and readLatency: concatenate
    for (const r of runs) {
      const c = r.chains[chain];
      if (!c) continue;
      out.revokeFromBatch.push(...c.revokeFromBatch);
      out.readLatency.push(...c.readLatency);
    }

    merged.chains[chain] = out;
  }

  return merged;
}

export function stageAggregate(opts: { runsDir?: string } = {}): string {
  const dir = opts.runsDir ?? path.resolve("benchmarks", "results");
  const runDirs = fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isDirectory() && f.startsWith("run-"))
    .sort();
  if (runDirs.length === 0) {
    throw new Error(`no run-* subdirectories in ${dir}`);
  }
  const runPaths: string[] = [];
  for (const sub of runDirs) {
    const subPath = path.join(dir, sub);
    const file = fs
      .readdirSync(subPath)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".partial.json"))
      .sort()
      .reverse()[0];
    if (file) runPaths.push(path.join(subPath, file));
  }
  const merged = aggregateRuns(runPaths);
  const outPath = path.join(dir, `aggregated-${Date.now()}.json`);
  atomicWriteJson(outPath, merged);
  console.log(`[aggregate] merged ${runPaths.length} runs → ${outPath}`);
  return outPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm -w @univerify/benchmarks test -- aggregate
```

Expected: 2 tests pass.

- [ ] **Step 5: Wire into `index.ts`**

In `packages/benchmarks/src/index.ts`, add the `aggregate` case and update `all`:

```ts
import { stageAggregate } from "./stages/aggregate.js";

// inside switch:
    case "aggregate": {
      const runsDir = argValue(rest, "dir");
      stageAggregate({ runsDir });
      return;
    }
    case "all": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      const runs = Number(argValue(rest, "runs") ?? "1");
      if (!Number.isInteger(runs) || runs < 1) {
        throw new Error(`--runs must be a positive integer, got ${runs}`);
      }
      await stageDeploy(only);
      for (let r = 1; r <= runs; r++) {
        if (runs > 1) console.log(`[all] run ${r}/${runs}`);
        await stageMeasure({
          only,
          runLabel: runs > 1 ? `run-${r}` : undefined,
        });
      }
      await stagePrice();
      if (runs > 1) {
        const aggregated = stageAggregate({});
        stageExport({ resultsPath: aggregated });
      } else {
        stageExport({});
      }
      return;
    }
```

Update usage line:

```ts
"Usage: benchmarks {deploy|measure|price|export|aggregate|all|smoke} [--chain=KEY] [--resume=RUN_ID] [--runs=N]"
```

- [ ] **Step 6: Build and test**

```bash
npm -w @univerify/benchmarks run build
npm -w @univerify/benchmarks test
```

Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add packages/benchmarks/src/stages/aggregate.ts packages/benchmarks/tests/stages/aggregate.test.ts packages/benchmarks/src/index.ts
git commit -m "feat(benchmarks): aggregate N independent runs into one RunResults"
```

Also expose the new script in the root `package.json` after the existing benchmark scripts:

```json
"benchmarks:aggregate": "npm -w @univerify/benchmarks run aggregate"
```

And in `packages/benchmarks/package.json` `scripts`:

```json
"aggregate": "node --import tsx src/index.ts aggregate"
```

- [ ] **Step 8: Commit script entries**

```bash
git add package.json packages/benchmarks/package.json
git commit -m "chore(benchmarks): expose 'aggregate' script at workspace root"
```

## Task C.7: Execute the 3-run pipeline and regenerate `docs/l2-benchmarks/data/`

**Files:**
- Will regenerate: `docs/l2-benchmarks/data/*.csv`, `*.dat`, `meta.json`
- Will update fixtures: `packages/benchmarks/tests/fixtures/results.fixture.json` (replace with aggregated)

This is the operator-driven step. The actual execution requires testnet ETH on all four chains and a single RPC provider.

- [ ] **Step 1: Operator prep**

Confirm:
1. `.env` has `RPC_SEPOLIA`, `RPC_ARBITRUM_SEPOLIA`, `RPC_BASE_SEPOLIA`, `RPC_ZKSYNC_SEPOLIA` all pointing at the **same provider and POP/region** (e.g., Alchemy `eth-sepolia.g.alchemy.com`, `arb-sepolia.g.alchemy.com`, `base-sepolia.g.alchemy.com`, `zksync-sepolia.g.alchemy.com`).
2. `.env` has `RPC_PROVIDER=<name>` and `RPC_REGION=<region>` for provenance recording.
3. `.env` has `BENCH_PK` set to a fresh, dedicated testnet wallet (rotate any prior key).
4. The wallet is funded with at least ~0.5 ETH equivalent on each testnet (issuing 1+10+100+1000+10000 leaves × 30 latency reps × 3 runs is substantial; estimate cost using one chain's `--runs=1` first).
5. `.env` has `BENCH_RANDOM_SEED` set explicitly (default `"univerify-phase-2"` is fine).

- [ ] **Step 2: Dry-run on Sepolia only**

```bash
npm run benchmarks:all -- --chain=sepolia --runs=1
```

Expected: clean run, partial files cleaned up, results in `benchmarks/results/`. Inspect `docs/l2-benchmarks/data/table-inclusion-latency.csv` for the new `issue_p50_ms` / `issue_sigma_ms` columns.

- [ ] **Step 3: Full 3-run execution**

```bash
npm run benchmarks:all -- --runs=3
```

Expected: 3 measurement passes per chain, aggregation, regenerated `docs/l2-benchmarks/data/`. This will take **hours** — keep a shell open and monitor logs.

- [ ] **Step 4: Verify outputs**

```bash
cat docs/l2-benchmarks/data/meta.json
head -2 docs/l2-benchmarks/data/table-inclusion-latency.csv
head -2 docs/l2-benchmarks/data/table-issue-cost.csv
```

Expected: `meta.json` shows `runs: 3` (add the field to `writeMeta` if not already there), `rpcProvider`, `rpcRegion`, `randomSeed`. Inclusion-latency table has `issue_sigma_ms` column.

Add to `writeMeta` in `stages/export.ts`:

```ts
runs: process.env.LAST_RUN_COUNT ? Number(process.env.LAST_RUN_COUNT) : 1,
```

Actually — simpler: have `stageAggregate` write a sidecar `aggregation-meta.json` containing the run count, and have `stageExport` read it when present. Or pass `runs` through as an optional argument on `stageExport`. Decision: pass via a small `aggregate-meta.json` next to the aggregated results file.

In `stages/aggregate.ts` `stageAggregate`, write alongside the aggregated file:

```ts
fs.writeFileSync(
  outPath.replace(/\.json$/, ".aggregate-meta.json"),
  JSON.stringify({ runs: runPaths.length, sources: runPaths }, null, 2)
);
```

In `stages/export.ts` `writeMeta`, check for a sibling `aggregate-meta.json` and merge if present.

Defer this polish to follow-up commit if time-pressed; the main goal of this task is regenerated data.

- [ ] **Step 5: Refresh CI fixtures**

```bash
cp benchmarks/results/aggregated-*.json packages/benchmarks/tests/fixtures/results.fixture.json
cp benchmarks/price-history/$(ls -1 benchmarks/price-history/ | sort | tail -1) packages/benchmarks/tests/fixtures/prices.fixture.json
```

Re-run the CI drift check locally:

```bash
npm -w @univerify/benchmarks run start -- export \
  --results=packages/benchmarks/tests/fixtures/results.fixture.json \
  --prices=packages/benchmarks/tests/fixtures/prices.fixture.json
git diff --stat docs/l2-benchmarks/data/
```

Expected: only `measured-at.tex` and `meta.json` (timestamp fields) differ.

- [ ] **Step 6: Commit data + fixtures**

```bash
git add docs/l2-benchmarks/data/ packages/benchmarks/tests/fixtures/ benchmarks/results/ benchmarks/price-history/
git commit -m "data(phase-2): regenerate tables from 3 runs, N=30 latency, randomized revoke, single RPC POP"
```

---

# Phase D — Thesis-prose

Goal: Update `docs/univerify-l2-benchmarks.tex` to reflect the new measurement methodology and disclose all remaining caveats.

## Task D.1: Expand `Ograniczenia pomiaru` section

**Files:**
- Modify: `docs/univerify-l2-benchmarks.tex`

- [ ] **Step 1: Locate the section**

```bash
grep -n "Ograniczenia\|Dyskusja\|Limitations" docs/univerify-l2-benchmarks.tex
```

Find the current `Ograniczenia pomiaru` subsection — likely a single paragraph in the `Dyskusja` section.

- [ ] **Step 2: Replace with expanded version**

Replace the existing `Ograniczenia pomiaru` paragraph with the following content (adjust paragraph framing to match the chapter's existing tone):

```latex
\subsection{Ograniczenia pomiaru}

Poniżej zebrano metodologiczne ograniczenia, których czytelnik powinien być świadomy interpretując wyniki. Cztery z pierwotnie zidentyfikowanych zostały wyeliminowane w toku rewizji eksperymentu (jednolity dostawca RPC, $N{=}30$ powtórzeń, losowy wybór liści do revoke, trzy niezależne runy z raportowaniem $\sigma$); pozostałe omówiono poniżej.

\paragraph{Założenie kompresji Brotli dla Arbitrum.} Model kosztu zapisu danych na L1 dla Arbitrum przyjmuje współczynnik kompresji Brotli równy 1.0, ponieważ dane Merkle (hashe pseudolosowe) nie kompresują się znacząco. Realny aplikacyjny calldata o strukturze rzadkiej kompresuje się 2--4-krotnie, co oznacza, że nasze oszacowanie kosztu L1 dla Arbitrum jest \textbf{górnym ograniczeniem}; rzeczywiste koszty produkcyjne mogą być proporcjonalnie niższe.

\paragraph{Niewspółmierność jednostki gazu w zkSync Era.} Wartość \texttt{gasUsed} raportowana przez zkSync (131{,}463 dla \texttt{issueBatch} z $n{=}1$) łączy w jednej jednostce koszt wykonania, dane publiczne i narzut bootloadera kontekstu Account Abstraction --- nie jest to ta sama jednostka, co \texttt{gasUsed} w EVM. Porównanie surowych liczb gazu między rodzinami rollupów jest \textbf{metodologicznie niepoprawne}; sensowne porównanie kosztów może odbywać się wyłącznie w USD lub ETH.

\paragraph{Inclusion latency jest ograniczona przez interwał odpytywania.} Pomiar czasu od submit do receipt opiera się o cykl odpytywania klienta viem (\textasciitilde 4\,s). Otrzymane wartości są zatem \textbf{górnym ograniczeniem czasu inkluzji w bloku}, a nie samym czasem inkluzji. Porównanie międzysieciowe jest dodatkowo zniekształcone interakcją czasu bloku z interwałem odpytywania.

\paragraph{Snapshot skalarów Base SystemConfig.} Model kosztu Base Ecotone używa snapshotu parametrów \texttt{baseFeeScalar=2269} i \texttt{blobBaseFeeScalar=1055762} pobranego z bloku L1 \texttt{25087416}. Po zmianie tych skalarów przez operatora Base wynikowe koszty zmieniłyby się proporcjonalnie; data snapshotu jest udokumentowana w \texttt{meta.json} każdego eksportu.

\paragraph{Snapshot kursu ETH/USD.} Wyniki w USD przeliczono kursem $\text{ETH}/\text{USD} = 3500$ (snapshot CoinGecko z dnia 2026-05-13). Wynik dla innego kursu można uzyskać mnożeniem przez czynnik $\frac{\text{nowy kurs}}{3500}$. Tabela~\ref{tab:sensitivity-eth} zawiera koszt na dyplom dla trzech wariantów kursu.

\paragraph{Konserwatywne ceny sekwensera L2.} Ceny gazu sekwensera L2 zostały ustawione na zaokrąglone wartości powyżej żywego snapshotu (Arbitrum 0.1\,gwei vs 0.02 żywe; Base 0.005 vs 0.006; zkSync 0.05 vs 0.0453), aby pochłonąć typowe wahania kongestii. Tabela~\ref{tab:sensitivity-l2price} przedstawia koszt przy 0{.}5$\times$, 1{.}0$\times$ i 2{.}0$\times$ snapshotu.
```

- [ ] **Step 3: Add citations to the eliminated caveats as well**

Right above the `\subsection{Ograniczenia pomiaru}` block, add a single brief paragraph at the end of the `Eksperyment` or `Metodologia` section noting:

```latex
Wszystkie pomiary opisane w niniejszym rozdziale wykonano przez jednego dostawcę RPC w jednej lokalizacji POP, z $N{=}30$ powtórzeniami dla każdego pomiaru opóźnienia oraz losowym wyborem liści przy revoke. Wyniki to średnia $\pm\sigma$ z trzech niezależnych runów. Wszystkie parametry konfiguracyjne (seed losowości, dostawca, region, kurs ETH/USD) są zapisane w pliku \texttt{docs/l2-benchmarks/data/meta.json}.
```

- [ ] **Step 4: Compile**

```bash
cd docs && latexmk -pdf -interaction=nonstopmode univerify-l2-benchmarks.tex
```

Expected: clean compile to `docs/univerify-l2-benchmarks.pdf`.

If `latexmk` is unavailable, fall back to:

```bash
cd docs && pdflatex -interaction=nonstopmode univerify-l2-benchmarks.tex
```

- [ ] **Step 5: Commit**

```bash
git add docs/univerify-l2-benchmarks.tex docs/univerify-l2-benchmarks.pdf
git commit -m "docs(thesis): expand Ograniczenia pomiaru with all remaining caveats"
```

## Task D.2: Add sensitivity tables

**Files:**
- Modify: `docs/univerify-l2-benchmarks.tex` — add two `table` environments referenced from D.1

- [ ] **Step 1: Add the ETH/USD sensitivity table**

Insert near the end of `Dyskusja`, before `Ograniczenia pomiaru`:

```latex
\begin{table}[h]
\centering
\caption{Wrażliwość kosztu na dyplom przy zmianie kursu ETH/USD. Wartości dla \texttt{batchSize}$=1000$, $p_{50}$ basefee, snapshot z 2026-05-13.}
\label{tab:sensitivity-eth}
\begin{tabular}{lrrr}
\hline
Łańcuch & $\$2000$ & $\$3500$ & $\$5000$ \\
\hline
Sepolia (L1) & TODO & TODO & TODO \\
Arbitrum Sepolia & TODO & TODO & TODO \\
Base Sepolia & TODO & TODO & TODO \\
zkSync Sepolia & TODO & TODO & TODO \\
\hline
\end{tabular}
\end{table}

\begin{table}[h]
\centering
\caption{Wrażliwość kosztu na dyplom przy skalowaniu cen sekwensera L2 (mnożnik względem snapshotu). Wartości dla \texttt{batchSize}$=1000$, $p_{50}$ basefee, $\text{ETH/USD}=3500$.}
\label{tab:sensitivity-l2price}
\begin{tabular}{lrrr}
\hline
Łańcuch & $0.5\times$ & $1.0\times$ & $2.0\times$ \\
\hline
Arbitrum Sepolia & TODO & TODO & TODO \\
Base Sepolia & TODO & TODO & TODO \\
zkSync Sepolia & TODO & TODO & TODO \\
\hline
\end{tabular}
\end{table}
```

- [ ] **Step 2: Compute sensitivity values**

For each chain at `batchSize=1000`:

```
table-issue-cost.csv → usd_p50_1000 column
sensitivity_eth_X = usd_p50_1000 * (X / 3500)
sensitivity_l2price_M = (gas_1000 * L2_PRICE_M_WEI + l1data_wei_1000) / 1e18 * 3500
```

Read the values from `docs/l2-benchmarks/data/table-issue-cost.csv` (regenerated in Phase C) and compute the three columns. Substitute TODO placeholders with computed values rounded to 6 decimal places.

Alternative (recommended for repeatability): add a one-off script `packages/benchmarks/src/cli/sensitivity.ts` that emits a LaTeX table fragment from the regenerated `table-issue-cost.csv`, and use `\input{...}` from the `.tex` file. Implementation:

```ts
// packages/benchmarks/src/cli/sensitivity.ts
// Reads docs/l2-benchmarks/data/table-issue-cost.csv and writes
// docs/l2-benchmarks/data/sensitivity-eth.tex + sensitivity-l2price.tex
```

If you go the script route, wire it into the `export` stage so it's automatically regenerated. Otherwise, hand-compute and inline once.

**Decision for this plan:** hand-compute and inline once. The values are stable now that Phase C is locked.

- [ ] **Step 3: Compile and commit**

```bash
cd docs && latexmk -pdf univerify-l2-benchmarks.tex
git add docs/univerify-l2-benchmarks.tex docs/univerify-l2-benchmarks.pdf
git commit -m "docs(thesis): sensitivity tables for ETH/USD and L2 sequencer prices"
```

## Task D.3: Reproducibility paragraph

**Files:**
- Modify: `docs/univerify-l2-benchmarks.tex`

- [ ] **Step 1: Add the paragraph**

Add a new subsection at the end of `Dyskusja`, after `Ograniczenia pomiaru`:

```latex
\subsection{Reprodukowalność}

Wszystkie wyniki w tym rozdziale można odtworzyć z czystego klona repozytorium UniVerify poleceniem \texttt{npm run benchmarks:all -{}- -{}-runs=3} po wypełnieniu pliku \texttt{.env} kluczem prywatnym portfela testowego oraz adresami RPC czterech sieci testnet (Sepolia, Arbitrum Sepolia, Base Sepolia, zkSync Sepolia). Pipeline wykonuje sekwencję \texttt{deploy} $\to$ \texttt{measure} $\to$ \texttt{price} $\to$ \texttt{aggregate} $\to$ \texttt{export}, regenerując wszystkie tabele i wykresy w \texttt{docs/l2-benchmarks/data/}. Każdy artefakt jest powiązany z plikiem \texttt{meta.json} zawierającym \texttt{runId}, \texttt{measuredAt}, kurs ETH/USD z datą snapshotu, ziarno losowości (\texttt{BENCH\_RANDOM\_SEED}), dostawcę i region RPC oraz listę łańcuchów. Plik \texttt{packages/benchmarks/README.md} dokumentuje wymagania środowiskowe i znane ograniczenia. CI repozytorium (\texttt{.github/workflows/benchmarks-drift.yml}) automatycznie regeneruje tabele z zacommitowanych próbek wyników i sygnalizuje rozjazd między źródłem a zatwierdzonymi danymi.
```

- [ ] **Step 2: Compile and commit**

```bash
cd docs && latexmk -pdf univerify-l2-benchmarks.tex
git add docs/univerify-l2-benchmarks.tex docs/univerify-l2-benchmarks.pdf
git commit -m "docs(thesis): add reproducibility subsection"
```

## Task D.4: Update tables to reference σ column and final sanity check

**Files:**
- Modify: `docs/univerify-l2-benchmarks.tex`

- [ ] **Step 1: Update inclusion-latency table reference**

Find the existing `table-inclusion-latency.csv` consumer in the `.tex` (e.g., a `\input{...}` or `\pgfplotstableread{...}`). The new CSV has additional columns `issue_p50_ms`, `issue_p95_ms`, `issue_sigma_ms`, `issue_n`. Either:

- Update the LaTeX table to include these columns alongside the existing revoke columns, OR
- Add a second LaTeX table for the issue-batch latency distribution.

Recommended: second table dedicated to `issueBatch` latency, with caption noting $N{=}30$ per size.

```latex
\begin{table}[h]
\centering
\caption{Opóźnienie inkluzji \texttt{issueBatch} dla \texttt{batchSize}$=1000$ ($N{=}30$ powtórzeń na łańcuch, 3 niezależne runy).}
\label{tab:issue-latency}
\pgfplotstabletypeset[
  col sep=comma,
  columns={chain, issue_p50_ms, issue_p95_ms, issue_sigma_ms, issue_n},
  columns/chain/.style={string type, column name=Łańcuch},
  columns/issue_p50_ms/.style={column name=$p_{50}$ (ms)},
  columns/issue_p95_ms/.style={column name=$p_{95}$ (ms)},
  columns/issue_sigma_ms/.style={column name=$\sigma$ (ms)},
  columns/issue_n/.style={column name=$N$},
]{\benchdata/table-inclusion-latency.csv}
\end{table}
```

(If the chapter does not already define `\benchdata`, substitute the literal path.)

- [ ] **Step 2: Compile and verify**

```bash
cd docs && latexmk -pdf univerify-l2-benchmarks.tex
```

Open `docs/univerify-l2-benchmarks.pdf` and verify:
- Cross-references (`\ref{tab:sensitivity-eth}`, `\ref{tab:sensitivity-l2price}`, `\ref{tab:issue-latency}`) resolve
- All cited limitations are present
- Reproducibility subsection appears
- No TODO placeholders remain in the sensitivity tables

- [ ] **Step 3: Final commit**

```bash
git add docs/univerify-l2-benchmarks.tex docs/univerify-l2-benchmarks.pdf
git commit -m "docs(thesis): issue-latency table with sigma, finalize Phase 2 chapter"
```

## Task D.5: Verify CI green, push branch

- [ ] **Step 1: Push the working branch (if not on `main` directly)**

```bash
git status
git log --oneline main..HEAD
```

If many commits accumulated on a branch, push and open a PR. If working on `main` (small project), just push:

```bash
git push origin <branch-name>
```

- [ ] **Step 2: Verify CI**

```bash
gh run watch
```

Expected: both `CI` and `Benchmarks drift` workflows green.

- [ ] **Step 3: Mark Phase 2 done in memory**

Update memory entry `project_thesis_phases` to note that Phase 2 finishing was completed on $(date), and consume / archive `project_phase2_writeup_caveats` and `project_phase2_code_followups`. (This is a memory action, not a code change.)

---

## Self-Review Notes

Spec coverage cross-check:

| Spec requirement | Covered by |
|---|---|
| `npm run benchmarks:all` end-to-end | A.1, C.5, C.6 |
| CI drift check | A.4 |
| README + CHANGELOG | A.2, A.3 |
| `execSync` → `execFileSync` | B.1 |
| Nonce manager with bump | B.2 |
| Atomic partial write + SIGINT | B.3 |
| Per-(chain, op, batchSize) resume | B.4 |
| `nextBatchId` binary search | B.5 |
| Exhaustiveness on `chainName` | B.6.1 |
| Hex validation on `BENCH_PK` | B.6.2 |
| Project-relative `Deploy.s.sol` | B.6.3 |
| Clock-source policy | B.6.4 |
| Single RPC POP | A.2 (docs) + C.4 (provenance) + C.7 (operator action) |
| N≥30 latency | C.3 |
| Randomized revoke | C.1, C.2 |
| 3-run aggregation with σ | C.5, C.6, C.7 |
| Thesis prose: 6 remaining caveats | D.1 |
| Sensitivity tables | D.2 |
| Reproducibility prose | D.3 |
| Final compile + verification | D.4, D.5 |

No spec section is left uncovered. Tasks B.6.x and C.7 contain operator/verification steps rather than TDD code — this is appropriate for opsec polish (B.6.1, B.6.4) and operational re-runs (C.7).
