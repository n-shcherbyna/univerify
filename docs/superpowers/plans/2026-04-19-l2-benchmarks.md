# L2 Benchmarks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible benchmark pipeline that measures `DiplomaRegistry` gas, L1-data-fee, and RPC latency across Sepolia L1 + three L2 testnets (Arbitrum, Base, zkSync), producing CSV/`.dat` artifacts and a Polish LaTeX thesis chapter.

**Architecture:** New workspace package `@univerify/benchmarks` with four decoupled stages (deploy / measure / price / export) communicating via committed JSON files. Chain-specific fee extraction hidden behind a `ChainAdapter` interface. Thesis chapter at `docs/univerify-l2-benchmarks.tex` reads only committed data files; no live RPC at render time.

**Tech Stack:** TypeScript (ES2022, NodeNext), viem for RPC, @univerify/sdk for `statusWithProof` reads, vitest for tests, Foundry for contract deployment, pgfplots + csvautotabular for LaTeX rendering.

**Spec:** [`docs/superpowers/specs/2026-04-19-l2-benchmarks-design.md`](../specs/2026-04-19-l2-benchmarks-design.md)

---

## File Structure

### New files

```
packages/benchmarks/
  package.json
  tsconfig.json
  vitest.config.ts
  README.md
  src/
    index.ts                       # CLI entry — parses subcommand, dispatches
    config.ts                      # CHAINS, BATCH_SIZES, LATENCY_N, READS_N
    chains/
      types.ts                     # ChainAdapter interface, NormalizedMetrics, TxRecord
      sepolia.ts                   # L1 adapter
      baseSepolia.ts                # OP-stack adapter (l1Fee/l1GasUsed on receipt)
      arbitrumSepolia.ts           # Arbitrum Nitro adapter (gasUsedForL1 on receipt)
      zksyncSepolia.ts             # zk-rollup adapter
      index.ts                     # getAdapter(chainId)
    ops/
      issueBatch.ts                # build Merkle tree off-chain, submit root
      revokeBatch.ts               # seed a batch, then N revokes
      readLatency.ts               # N timed statusWithProof calls
    stages/
      deploy.ts                    # Stage 1 — wraps forge script
      measure.ts                   # Stage 2 — orchestrator + --resume
      price.ts                     # Stage 3 — basefee history fetch & cache
      export.ts                    # Stage 4 — CSV + .dat + meta.json emission
    util/
      timing.ts                    # performance.now wrapper, percentile, trimmed mean
      wallet.ts                    # funded testnet wallet from BENCH_PK
      runId.ts                     # timestamp-based run id generator
  tests/
    fixtures/
      receipts/
        sepolia-issue-1.json
        baseSepolia-issue-100.json
        arbitrumSepolia-issue-100.json
        zksyncSepolia-issue-100.json
      results/
        tiny-run.json               # synthetic 2-chain, 2-size fixture
      price-history/
        tiny-prices.json            # synthetic 90-day basefee series
    chains/
      sepolia.test.ts
      baseSepolia.test.ts
      arbitrumSepolia.test.ts
      zksyncSepolia.test.ts
    stages/
      price.test.ts
      export.test.ts
    util/
      timing.test.ts

benchmarks/                          # data, committed selectively
  .gitkeep
  results/
    .gitkeep
  price-history/
    .gitkeep

docs/
  univerify-l2-benchmarks.tex       # Polish thesis chapter
  l2-benchmarks/
    data/                           # exporter output; .csv + .dat + meta.json
      .gitkeep
```

### Modified files

- `package.json` (root) — add scripts `benchmarks:*` that delegate to the new workspace.
- `vitest.config.ts` (root) — register `packages/benchmarks/vitest.config.ts` in `projects`.
- `.gitignore` — keep `benchmarks/results/*.partial.json` out of git.

---

## Task 1: Package scaffolding

**Files:**
- Create: `packages/benchmarks/package.json`
- Create: `packages/benchmarks/tsconfig.json`
- Create: `packages/benchmarks/vitest.config.ts`
- Create: `packages/benchmarks/README.md` (stub — expanded in Task 22)
- Modify: `vitest.config.ts` (root)
- Modify: `.gitignore`
- Create: `benchmarks/results/.gitkeep`
- Create: `benchmarks/price-history/.gitkeep`
- Create: `docs/l2-benchmarks/data/.gitkeep`

- [ ] **Step 1: Create `packages/benchmarks/package.json`**

```json
{
  "name": "@univerify/benchmarks",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "start": "node --import tsx src/index.ts",
    "deploy": "node --import tsx src/index.ts deploy",
    "measure": "node --import tsx src/index.ts measure",
    "price": "node --import tsx src/index.ts price",
    "export": "node --import tsx src/index.ts export",
    "all": "node --import tsx src/index.ts all",
    "smoke": "node --import tsx src/index.ts smoke"
  },
  "dependencies": {
    "@univerify/verifier-core": "file:../verifier-core",
    "viem": "^2.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 2: Create `packages/benchmarks/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "declaration": true,
    "strict": true,
    "skipLibCheck": true,
    "esModuleInterop": true,
    "resolveJsonModule": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `packages/benchmarks/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "benchmarks",
    include: ["tests/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Register project in root `vitest.config.ts`**

Modify `vitest.config.ts` at repo root — add the new project:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/verifier-core/vitest.config.ts",
      "apps/web/vitest.config.ts",
      "packages/benchmarks/vitest.config.ts",
    ],
  },
});
```

- [ ] **Step 5: Create stub README**

`packages/benchmarks/README.md`:

```markdown
# @univerify/benchmarks

L2 benchmark pipeline for UniVerify. See top-level design doc at
`docs/superpowers/specs/2026-04-19-l2-benchmarks-design.md`.

Full usage instructions added in Task 22.
```

- [ ] **Step 6: Create data directories with `.gitkeep`**

```bash
mkdir -p benchmarks/results benchmarks/price-history docs/l2-benchmarks/data
touch benchmarks/results/.gitkeep benchmarks/price-history/.gitkeep docs/l2-benchmarks/data/.gitkeep
```

- [ ] **Step 7: Update `.gitignore`**

Append to `.gitignore`:

```
# Benchmarks — ignore partial/in-progress run state
benchmarks/results/*.partial.json
```

- [ ] **Step 8: Install the new workspace**

Run: `npm install`
Expected: `npm` resolves the new workspace under `node_modules/@univerify/benchmarks`.

- [ ] **Step 9: Verify scaffolding compiles (empty build)**

Create a placeholder `packages/benchmarks/src/index.ts`:

```ts
export {};
```

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds, emits `packages/benchmarks/dist/index.js`.

- [ ] **Step 10: Commit**

```bash
git add packages/benchmarks vitest.config.ts .gitignore benchmarks docs/l2-benchmarks/data/.gitkeep
git commit -m "chore(benchmarks): scaffold @univerify/benchmarks workspace"
```

---

## Task 2: Core types

**Files:**
- Create: `packages/benchmarks/src/chains/types.ts`

- [ ] **Step 1: Write the types**

```ts
// packages/benchmarks/src/chains/types.ts
import type { Address, Hex, PublicClient, WalletClient } from "viem";

export type OpKind = "issueBatch" | "revokeFromBatch" | "statusWithProof";

export type NormalizedMetrics = {
  chainId: number;
  chainName: string;
  op: OpKind;
  /** Only present for issueBatch. */
  batchSize?: number;
  /** Only present for issueBatch; tags the seed batch used to prime revokeBatch. */
  tag?: "seed" | "main";
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  l1DataFee: bigint;
  l1GasUsed?: bigint;
  calldataBytes: number;
  blockNumber: bigint;
  txHash: Hex;
  submittedAt: number;
  includedAt: number;
  inclusionLatencyMs: number;
};

export type ReadLatencySample = {
  chainId: number;
  chainName: string;
  op: "statusWithProof";
  latencyMs: number;
  sampledAt: number;
};

export type TxSubmission = {
  txHash: Hex;
  calldata: Hex;
  submittedAt: number;
};

export interface ChainAdapter {
  chainId: number;
  name: string;
  /** viem public client used for reads and receipt polling. */
  publicClient: PublicClient;
  /** viem wallet client used for signed writes. */
  walletClient: WalletClient;
  /** Deployment address for DiplomaRegistry on this chain. */
  registryAddress: Address;
  /**
   * Parse a chain-specific receipt into NormalizedMetrics. Each adapter knows
   * where the L1 data fee lives on its chain (or that it is zero for L1).
   */
  parseReceipt(
    submission: TxSubmission,
    op: OpKind,
    extra?: { batchSize?: number; tag?: "seed" | "main" }
  ): Promise<NormalizedMetrics>;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds with no output errors.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/chains/types.ts
git commit -m "feat(benchmarks): add ChainAdapter + NormalizedMetrics types"
```

---

## Task 3: Config module

**Files:**
- Create: `packages/benchmarks/src/config.ts`

- [ ] **Step 1: Write config**

```ts
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
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/config.ts
git commit -m "feat(benchmarks): add chains and sample-size config"
```

---

## Task 4: Timing utility

**Files:**
- Create: `packages/benchmarks/src/util/timing.ts`
- Test: `packages/benchmarks/tests/util/timing.test.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/benchmarks/tests/util/timing.test.ts
import { describe, it, expect } from "vitest";
import { percentile, trimmedMean, sortAsc } from "../../src/util/timing.js";

describe("percentile", () => {
  it("returns the kth percentile of a sorted copy of samples", () => {
    const samples = [100, 50, 300, 200, 150];
    expect(percentile(samples, 0.5)).toBe(150);
    expect(percentile(samples, 0.95)).toBeGreaterThanOrEqual(200);
  });

  it("throws on empty input", () => {
    expect(() => percentile([], 0.5)).toThrow();
  });
});

describe("trimmedMean", () => {
  it("drops top and bottom proportionally", () => {
    const samples = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // 20% trim on each side → drops 1,2 and 9,10
    expect(trimmedMean(samples, 0.2)).toBe((3 + 4 + 5 + 6 + 7 + 8) / 6);
  });
});

describe("sortAsc", () => {
  it("returns ascending copy without mutating input", () => {
    const input = [3, 1, 2];
    const sorted = sortAsc(input);
    expect(sorted).toEqual([1, 2, 3]);
    expect(input).toEqual([3, 1, 2]);
  });
});
```

- [ ] **Step 2: Run test to verify failure**

Run: `npm -w @univerify/benchmarks test -- tests/util/timing.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement timing util**

```ts
// packages/benchmarks/src/util/timing.ts

/** Returns ms since a monotonic epoch. Safe to diff; do NOT interpret as wall clock. */
export function now(): number {
  return performance.now();
}

export function sortAsc(samples: number[]): number[] {
  return [...samples].sort((a, b) => a - b);
}

export function percentile(samples: number[], p: number): number {
  if (samples.length === 0) throw new Error("percentile: empty samples");
  if (p < 0 || p > 1) throw new Error("percentile: p must be in [0, 1]");
  const s = sortAsc(samples);
  const idx = Math.min(s.length - 1, Math.floor(p * s.length));
  return s[idx];
}

export function trimmedMean(samples: number[], trim: number): number {
  if (samples.length === 0) throw new Error("trimmedMean: empty samples");
  if (trim < 0 || trim >= 0.5) throw new Error("trimmedMean: trim in [0, 0.5)");
  const s = sortAsc(samples);
  const k = Math.floor(s.length * trim);
  const kept = s.slice(k, s.length - k);
  return kept.reduce((acc, v) => acc + v, 0) / kept.length;
}
```

- [ ] **Step 4: Run test to verify passing**

Run: `npm -w @univerify/benchmarks test -- tests/util/timing.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/benchmarks/src/util/timing.ts packages/benchmarks/tests/util/timing.test.ts
git commit -m "feat(benchmarks): add timing helpers (percentile, trimmedMean)"
```

---

## Task 5: Wallet + runId utilities

**Files:**
- Create: `packages/benchmarks/src/util/wallet.ts`
- Create: `packages/benchmarks/src/util/runId.ts`

- [ ] **Step 1: Implement wallet util**

```ts
// packages/benchmarks/src/util/wallet.ts
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";

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
  return privateKeyToAccount(pk as `0x${string}`);
}
```

- [ ] **Step 2: Implement runId util**

```ts
// packages/benchmarks/src/util/runId.ts

/** Deterministic, sortable run id: 20240419T143055-3f2a. */
export function newRunId(): string {
  const d = new Date();
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  const ts =
    d.getUTCFullYear() +
    pad(d.getUTCMonth() + 1) +
    pad(d.getUTCDate()) +
    "T" +
    pad(d.getUTCHours()) +
    pad(d.getUTCMinutes()) +
    pad(d.getUTCSeconds());
  const rand = Math.floor(Math.random() * 0x10000)
    .toString(16)
    .padStart(4, "0");
  return `${ts}-${rand}`;
}
```

- [ ] **Step 3: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/benchmarks/src/util/wallet.ts packages/benchmarks/src/util/runId.ts
git commit -m "feat(benchmarks): add wallet loader and run-id generator"
```

---

## Task 6: Sepolia (L1) adapter

**Files:**
- Create: `packages/benchmarks/src/chains/sepolia.ts`
- Create: `packages/benchmarks/tests/fixtures/receipts/sepolia-issue-1.json`
- Test: `packages/benchmarks/tests/chains/sepolia.test.ts`

- [ ] **Step 1: Create fixture receipt**

`packages/benchmarks/tests/fixtures/receipts/sepolia-issue-1.json` — a minimal, valid Sepolia receipt shape for `issueBatch` of a 1-leaf batch:

```json
{
  "transactionHash": "0xaaaaaa00000000000000000000000000000000000000000000000000000001",
  "blockNumber": "0x123456",
  "gasUsed": "0xd6d8",
  "effectiveGasPrice": "0x59682f00",
  "status": "0x1",
  "logs": []
}
```

Notes: `gasUsed=0xd6d8` → 55 000 (representative for a single-sstore + event).

- [ ] **Step 2: Write failing test**

```ts
// packages/benchmarks/tests/chains/sepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/sepolia-issue-1.json";
import { createSepoliaAdapter } from "../../src/chains/sepolia.js";

describe("sepolia adapter", () => {
  it("parses a receipt into NormalizedMetrics with l1DataFee=0", async () => {
    const adapter = createSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    // Stub the viem publicClient.getTransactionReceipt
    vi.spyOn(adapter.publicClient, "waitForTransactionReceipt").mockResolvedValue({
      ...receipt,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: BigInt(receipt.gasUsed),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
    } as never);

    const metrics = await adapter.parseReceipt(
      {
        txHash: receipt.transactionHash as `0x${string}`,
        calldata: "0xabcd" as `0x${string}`,
        submittedAt: 1000,
      },
      "issueBatch",
      { batchSize: 1, tag: "main" }
    );

    expect(metrics.chainId).toBe(11155111);
    expect(metrics.gasUsed).toBe(55_000n);
    expect(metrics.l1DataFee).toBe(0n);
    expect(metrics.l1GasUsed).toBeUndefined();
    expect(metrics.calldataBytes).toBe(2); // 0xabcd = 2 bytes
    expect(metrics.batchSize).toBe(1);
    expect(metrics.op).toBe("issueBatch");
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm -w @univerify/benchmarks test -- tests/chains/sepolia.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 4: Implement adapter**

```ts
// packages/benchmarks/src/chains/sepolia.ts
import {
  createPublicClient,
  createWalletClient,
  http,
  hexToBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { sepolia } from "viem/chains";
import type {
  ChainAdapter,
  NormalizedMetrics,
  OpKind,
  TxSubmission,
} from "./types.js";
import { now } from "../util/timing.js";
import { RECEIPT_TIMEOUT_MS } from "../config.js";

export type SepoliaAdapterInit = {
  rpcUrl: string;
  registryAddress: Address;
  account: Parameters<typeof createWalletClient>[0]["account"];
};

export function createSepoliaAdapter(init: SepoliaAdapterInit): ChainAdapter {
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(init.rpcUrl),
  }) as PublicClient;

  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(init.rpcUrl),
    account: init.account,
  }) as WalletClient;

  return {
    chainId: 11155111,
    name: "sepolia",
    publicClient,
    walletClient,
    registryAddress: init.registryAddress,
    async parseReceipt(
      submission: TxSubmission,
      op: OpKind,
      extra?: { batchSize?: number; tag?: "seed" | "main" }
    ): Promise<NormalizedMetrics> {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: submission.txHash,
        timeout: RECEIPT_TIMEOUT_MS,
      });
      const includedAt = now();
      return {
        chainId: 11155111,
        chainName: "sepolia",
        op,
        batchSize: extra?.batchSize,
        tag: extra?.tag,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        l1DataFee: 0n,
        calldataBytes: hexToBytes(submission.calldata).length,
        blockNumber: receipt.blockNumber,
        txHash: receipt.transactionHash as Hex,
        submittedAt: submission.submittedAt,
        includedAt,
        inclusionLatencyMs: includedAt - submission.submittedAt,
      };
    },
  };
}
```

- [ ] **Step 5: Run test to verify passing**

Run: `npm -w @univerify/benchmarks test -- tests/chains/sepolia.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/chains/sepolia.ts packages/benchmarks/tests/chains/sepolia.test.ts packages/benchmarks/tests/fixtures/receipts/sepolia-issue-1.json
git commit -m "feat(benchmarks): add Sepolia L1 adapter"
```

---

## Task 7: Base Sepolia adapter

**Files:**
- Create: `packages/benchmarks/src/chains/baseSepolia.ts`
- Create: `packages/benchmarks/tests/fixtures/receipts/baseSepolia-issue-100.json`
- Test: `packages/benchmarks/tests/chains/baseSepolia.test.ts`

**Background:** OP-stack chains (Base, Optimism) expose three extra fields on the receipt: `l1Fee` (paid L1 data cost in wei), `l1GasUsed` (calldata posting gas), and `l1GasPrice` (L1 gas price used for posting). viem returns these via the receipt — we read them directly.

- [ ] **Step 1: Create fixture receipt**

`packages/benchmarks/tests/fixtures/receipts/baseSepolia-issue-100.json`:

```json
{
  "transactionHash": "0xbbbbbb00000000000000000000000000000000000000000000000000000001",
  "blockNumber": "0x2345678",
  "gasUsed": "0xd6d8",
  "effectiveGasPrice": "0x186a0",
  "l1Fee": "0x5af3107a4000",
  "l1GasUsed": "0x2710",
  "l1GasPrice": "0x59682f00",
  "status": "0x1",
  "logs": []
}
```

- [ ] **Step 2: Write failing test**

```ts
// packages/benchmarks/tests/chains/baseSepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/baseSepolia-issue-100.json";
import { createBaseSepoliaAdapter } from "../../src/chains/baseSepolia.js";

describe("baseSepolia adapter", () => {
  it("parses l1Fee and l1GasUsed from receipt", async () => {
    const adapter = createBaseSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    vi.spyOn(adapter.publicClient, "waitForTransactionReceipt").mockResolvedValue({
      ...receipt,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: BigInt(receipt.gasUsed),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
      l1Fee: BigInt(receipt.l1Fee),
      l1GasUsed: BigInt(receipt.l1GasUsed),
      l1GasPrice: BigInt(receipt.l1GasPrice),
    } as never);

    const metrics = await adapter.parseReceipt(
      {
        txHash: receipt.transactionHash as `0x${string}`,
        calldata: "0xabcd" as `0x${string}`,
        submittedAt: 2000,
      },
      "issueBatch",
      { batchSize: 100, tag: "main" }
    );

    expect(metrics.chainId).toBe(84532);
    expect(metrics.l1DataFee).toBe(BigInt(receipt.l1Fee));
    expect(metrics.l1GasUsed).toBe(BigInt(receipt.l1GasUsed));
    expect(metrics.batchSize).toBe(100);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm -w @univerify/benchmarks test -- tests/chains/baseSepolia.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement adapter**

```ts
// packages/benchmarks/src/chains/baseSepolia.ts
import {
  createPublicClient,
  createWalletClient,
  http,
  hexToBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { baseSepolia } from "viem/chains";
import type {
  ChainAdapter,
  NormalizedMetrics,
  OpKind,
  TxSubmission,
} from "./types.js";
import { now } from "../util/timing.js";
import { RECEIPT_TIMEOUT_MS } from "../config.js";

export type BaseSepoliaAdapterInit = {
  rpcUrl: string;
  registryAddress: Address;
  account: Parameters<typeof createWalletClient>[0]["account"];
};

type OpStackReceipt = {
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  l1Fee?: bigint;
  l1GasUsed?: bigint;
};

export function createBaseSepoliaAdapter(init: BaseSepoliaAdapterInit): ChainAdapter {
  const publicClient = createPublicClient({
    chain: baseSepolia,
    transport: http(init.rpcUrl),
  }) as PublicClient;

  const walletClient = createWalletClient({
    chain: baseSepolia,
    transport: http(init.rpcUrl),
    account: init.account,
  }) as WalletClient;

  return {
    chainId: 84532,
    name: "baseSepolia",
    publicClient,
    walletClient,
    registryAddress: init.registryAddress,
    async parseReceipt(
      submission: TxSubmission,
      op: OpKind,
      extra?: { batchSize?: number; tag?: "seed" | "main" }
    ): Promise<NormalizedMetrics> {
      const receipt = (await publicClient.waitForTransactionReceipt({
        hash: submission.txHash,
        timeout: RECEIPT_TIMEOUT_MS,
      })) as unknown as OpStackReceipt;
      const includedAt = now();
      return {
        chainId: 84532,
        chainName: "baseSepolia",
        op,
        batchSize: extra?.batchSize,
        tag: extra?.tag,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        l1DataFee: receipt.l1Fee ?? 0n,
        l1GasUsed: receipt.l1GasUsed,
        calldataBytes: hexToBytes(submission.calldata).length,
        blockNumber: receipt.blockNumber,
        txHash: receipt.transactionHash,
        submittedAt: submission.submittedAt,
        includedAt,
        inclusionLatencyMs: includedAt - submission.submittedAt,
      };
    },
  };
}
```

- [ ] **Step 5: Run test to verify passing**

Run: `npm -w @univerify/benchmarks test -- tests/chains/baseSepolia.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/chains/baseSepolia.ts packages/benchmarks/tests/chains/baseSepolia.test.ts packages/benchmarks/tests/fixtures/receipts/baseSepolia-issue-100.json
git commit -m "feat(benchmarks): add Base Sepolia (OP-stack) adapter"
```

---

## Task 8: Arbitrum Sepolia adapter

**Files:**
- Create: `packages/benchmarks/src/chains/arbitrumSepolia.ts`
- Create: `packages/benchmarks/tests/fixtures/receipts/arbitrumSepolia-issue-100.json`
- Test: `packages/benchmarks/tests/chains/arbitrumSepolia.test.ts`

**Background:** Arbitrum Nitro receipts include `gasUsedForL1` (the L1 calldata-posting gas charged as part of `gasUsed`). The total L1 data fee is therefore `gasUsedForL1 × effectiveGasPrice` — the L1 component is already baked into `gasUsed × effectiveGasPrice`. We report it separately so the thesis can decompose it.

- [ ] **Step 1: Create fixture receipt**

`packages/benchmarks/tests/fixtures/receipts/arbitrumSepolia-issue-100.json`:

```json
{
  "transactionHash": "0xcccccc00000000000000000000000000000000000000000000000000000001",
  "blockNumber": "0x3456789",
  "gasUsed": "0x30d40",
  "effectiveGasPrice": "0x5f5e100",
  "gasUsedForL1": "0x249f0",
  "status": "0x1",
  "logs": []
}
```

- [ ] **Step 2: Write failing test**

```ts
// packages/benchmarks/tests/chains/arbitrumSepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/arbitrumSepolia-issue-100.json";
import { createArbitrumSepoliaAdapter } from "../../src/chains/arbitrumSepolia.js";

describe("arbitrumSepolia adapter", () => {
  it("derives l1DataFee = gasUsedForL1 × effectiveGasPrice", async () => {
    const adapter = createArbitrumSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    vi.spyOn(adapter.publicClient, "waitForTransactionReceipt").mockResolvedValue({
      ...receipt,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: BigInt(receipt.gasUsed),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
      gasUsedForL1: BigInt(receipt.gasUsedForL1),
    } as never);

    const metrics = await adapter.parseReceipt(
      {
        txHash: receipt.transactionHash as `0x${string}`,
        calldata: "0xabcd" as `0x${string}`,
        submittedAt: 3000,
      },
      "issueBatch",
      { batchSize: 100, tag: "main" }
    );

    expect(metrics.chainId).toBe(421614);
    expect(metrics.l1GasUsed).toBe(BigInt(receipt.gasUsedForL1));
    expect(metrics.l1DataFee).toBe(
      BigInt(receipt.gasUsedForL1) * BigInt(receipt.effectiveGasPrice)
    );
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm -w @univerify/benchmarks test -- tests/chains/arbitrumSepolia.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement adapter**

```ts
// packages/benchmarks/src/chains/arbitrumSepolia.ts
import {
  createPublicClient,
  createWalletClient,
  http,
  hexToBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import { arbitrumSepolia } from "viem/chains";
import type {
  ChainAdapter,
  NormalizedMetrics,
  OpKind,
  TxSubmission,
} from "./types.js";
import { now } from "../util/timing.js";
import { RECEIPT_TIMEOUT_MS } from "../config.js";

export type ArbitrumSepoliaAdapterInit = {
  rpcUrl: string;
  registryAddress: Address;
  account: Parameters<typeof createWalletClient>[0]["account"];
};

type ArbReceipt = {
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  blockNumber: bigint;
  transactionHash: Hex;
  gasUsedForL1?: bigint;
};

export function createArbitrumSepoliaAdapter(
  init: ArbitrumSepoliaAdapterInit
): ChainAdapter {
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(init.rpcUrl),
  }) as PublicClient;

  const walletClient = createWalletClient({
    chain: arbitrumSepolia,
    transport: http(init.rpcUrl),
    account: init.account,
  }) as WalletClient;

  return {
    chainId: 421614,
    name: "arbitrumSepolia",
    publicClient,
    walletClient,
    registryAddress: init.registryAddress,
    async parseReceipt(
      submission: TxSubmission,
      op: OpKind,
      extra?: { batchSize?: number; tag?: "seed" | "main" }
    ): Promise<NormalizedMetrics> {
      const receipt = (await publicClient.waitForTransactionReceipt({
        hash: submission.txHash,
        timeout: RECEIPT_TIMEOUT_MS,
      })) as unknown as ArbReceipt;
      const includedAt = now();
      const gasUsedForL1 = receipt.gasUsedForL1 ?? 0n;
      return {
        chainId: 421614,
        chainName: "arbitrumSepolia",
        op,
        batchSize: extra?.batchSize,
        tag: extra?.tag,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        l1DataFee: gasUsedForL1 * receipt.effectiveGasPrice,
        l1GasUsed: gasUsedForL1,
        calldataBytes: hexToBytes(submission.calldata).length,
        blockNumber: receipt.blockNumber,
        txHash: receipt.transactionHash,
        submittedAt: submission.submittedAt,
        includedAt,
        inclusionLatencyMs: includedAt - submission.submittedAt,
      };
    },
  };
}
```

- [ ] **Step 5: Run test to verify passing**

Run: `npm -w @univerify/benchmarks test -- tests/chains/arbitrumSepolia.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/chains/arbitrumSepolia.ts packages/benchmarks/tests/chains/arbitrumSepolia.test.ts packages/benchmarks/tests/fixtures/receipts/arbitrumSepolia-issue-100.json
git commit -m "feat(benchmarks): add Arbitrum Sepolia adapter"
```

---

## Task 9: zkSync Sepolia adapter

**Files:**
- Create: `packages/benchmarks/src/chains/zksyncSepolia.ts`
- Create: `packages/benchmarks/tests/fixtures/receipts/zksyncSepolia-issue-100.json`
- Test: `packages/benchmarks/tests/chains/zksyncSepolia.test.ts`

**Background:** zkSync Era's fee model is a single `gasUsed × effectiveGasPrice` amount where the L1-data cost is already folded in. There is no standard receipt field that splits it. For the thesis we report the combined cost as `gasUsed × effectiveGasPrice` and set `l1DataFee = 0n` (the receipt does not expose it). The methodology chapter calls this out explicitly. If zkSync tooling proves unworkable, the plan falls back to Scroll Sepolia by replacing this file.

- [ ] **Step 1: Create fixture receipt**

`packages/benchmarks/tests/fixtures/receipts/zksyncSepolia-issue-100.json`:

```json
{
  "transactionHash": "0xdddddd00000000000000000000000000000000000000000000000000000001",
  "blockNumber": "0x456789a",
  "gasUsed": "0x493e0",
  "effectiveGasPrice": "0x17d7840",
  "status": "0x1",
  "logs": []
}
```

- [ ] **Step 2: Write failing test**

```ts
// packages/benchmarks/tests/chains/zksyncSepolia.test.ts
import { describe, it, expect, vi } from "vitest";
import receipt from "../fixtures/receipts/zksyncSepolia-issue-100.json";
import { createZkSyncSepoliaAdapter } from "../../src/chains/zksyncSepolia.js";

describe("zksyncSepolia adapter", () => {
  it("reports l1DataFee=0 and includes bundled L1 cost in gasUsed×price", async () => {
    const adapter = createZkSyncSepoliaAdapter({
      rpcUrl: "http://mock",
      registryAddress: "0x0000000000000000000000000000000000000001",
      account: {} as never,
    });

    vi.spyOn(adapter.publicClient, "waitForTransactionReceipt").mockResolvedValue({
      ...receipt,
      blockNumber: BigInt(receipt.blockNumber),
      gasUsed: BigInt(receipt.gasUsed),
      effectiveGasPrice: BigInt(receipt.effectiveGasPrice),
    } as never);

    const metrics = await adapter.parseReceipt(
      {
        txHash: receipt.transactionHash as `0x${string}`,
        calldata: "0xabcd" as `0x${string}`,
        submittedAt: 4000,
      },
      "issueBatch",
      { batchSize: 100, tag: "main" }
    );

    expect(metrics.chainId).toBe(300);
    expect(metrics.l1DataFee).toBe(0n);
    expect(metrics.gasUsed).toBe(BigInt(receipt.gasUsed));
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm -w @univerify/benchmarks test -- tests/chains/zksyncSepolia.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement adapter**

```ts
// packages/benchmarks/src/chains/zksyncSepolia.ts
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  hexToBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type {
  ChainAdapter,
  NormalizedMetrics,
  OpKind,
  TxSubmission,
} from "./types.js";
import { now } from "../util/timing.js";
import { RECEIPT_TIMEOUT_MS } from "../config.js";

const zksyncSepolia = defineChain({
  id: 300,
  name: "zkSync Sepolia Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.era.zksync.dev"] } },
  testnet: true,
});

export type ZkSyncSepoliaAdapterInit = {
  rpcUrl: string;
  registryAddress: Address;
  account: Parameters<typeof createWalletClient>[0]["account"];
};

export function createZkSyncSepoliaAdapter(
  init: ZkSyncSepoliaAdapterInit
): ChainAdapter {
  const publicClient = createPublicClient({
    chain: zksyncSepolia,
    transport: http(init.rpcUrl),
  }) as PublicClient;

  const walletClient = createWalletClient({
    chain: zksyncSepolia,
    transport: http(init.rpcUrl),
    account: init.account,
  }) as WalletClient;

  return {
    chainId: 300,
    name: "zksyncSepolia",
    publicClient,
    walletClient,
    registryAddress: init.registryAddress,
    async parseReceipt(
      submission: TxSubmission,
      op: OpKind,
      extra?: { batchSize?: number; tag?: "seed" | "main" }
    ): Promise<NormalizedMetrics> {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: submission.txHash,
        timeout: RECEIPT_TIMEOUT_MS,
      });
      const includedAt = now();
      return {
        chainId: 300,
        chainName: "zksyncSepolia",
        op,
        batchSize: extra?.batchSize,
        tag: extra?.tag,
        gasUsed: receipt.gasUsed,
        effectiveGasPrice: receipt.effectiveGasPrice,
        l1DataFee: 0n,
        calldataBytes: hexToBytes(submission.calldata).length,
        blockNumber: receipt.blockNumber,
        txHash: receipt.transactionHash as Hex,
        submittedAt: submission.submittedAt,
        includedAt,
        inclusionLatencyMs: includedAt - submission.submittedAt,
      };
    },
  };
}
```

- [ ] **Step 5: Run test to verify passing**

Run: `npm -w @univerify/benchmarks test -- tests/chains/zksyncSepolia.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/chains/zksyncSepolia.ts packages/benchmarks/tests/chains/zksyncSepolia.test.ts packages/benchmarks/tests/fixtures/receipts/zksyncSepolia-issue-100.json
git commit -m "feat(benchmarks): add zkSync Sepolia adapter"
```

---

## Task 10: Adapter registry

**Files:**
- Create: `packages/benchmarks/src/chains/index.ts`

- [ ] **Step 1: Write registry**

```ts
// packages/benchmarks/src/chains/index.ts
import fs from "node:fs";
import path from "node:path";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Address } from "viem";
import { CHAIN_IDS, RPC_ENV, type ChainKey } from "../config.js";
import type { ChainAdapter } from "./types.js";
import { createSepoliaAdapter } from "./sepolia.js";
import { createBaseSepoliaAdapter } from "./baseSepolia.js";
import { createArbitrumSepoliaAdapter } from "./arbitrumSepolia.js";
import { createZkSyncSepoliaAdapter } from "./zksyncSepolia.js";

function loadRegistryAddress(chainId: number): Address {
  const p = path.resolve("contracts", "deployments", `${chainId}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Missing deployment file: ${p}. Run Stage 1 (deploy) for chainId=${chainId}.`
    );
  }
  const j = JSON.parse(fs.readFileSync(p, "utf8")) as { DiplomaRegistry?: string };
  if (!j.DiplomaRegistry) {
    throw new Error(`Malformed deployment file at ${p}: missing DiplomaRegistry.`);
  }
  return j.DiplomaRegistry as Address;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; see packages/benchmarks/README.md`);
  return v;
}

export function getAdapter(key: ChainKey, account: PrivateKeyAccount): ChainAdapter {
  const chainId = CHAIN_IDS[key];
  const rpcUrl = requireEnv(RPC_ENV[key]);
  const registryAddress = loadRegistryAddress(chainId);
  switch (key) {
    case "sepolia":
      return createSepoliaAdapter({ rpcUrl, registryAddress, account });
    case "baseSepolia":
      return createBaseSepoliaAdapter({ rpcUrl, registryAddress, account });
    case "arbitrumSepolia":
      return createArbitrumSepoliaAdapter({ rpcUrl, registryAddress, account });
    case "zksyncSepolia":
      return createZkSyncSepoliaAdapter({ rpcUrl, registryAddress, account });
  }
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/chains/index.ts
git commit -m "feat(benchmarks): add chain adapter registry"
```

---

## Task 11: `issueBatch` operation

**Files:**
- Create: `packages/benchmarks/src/ops/issueBatch.ts`

**Background:** The on-chain write function is `issueBatchRoot(batchId, merkleRoot)` — takes a single `bytes32` root. Merkle leaves are domain-separated via `computeMerkleLeaf({ registry, chainId, issuer, batchId, docHash })` from `@univerify/verifier-core`; we build them off-chain from synthetic `docHash` values. Only the root is sent on-chain.

The helper `makeSyntheticDocHashes` is the deterministic seed source — the same seed string always produces the same docHash sequence, which is what lets `revokeBatch` and `readLatency` later reconstruct the exact leaves and proofs.

- [ ] **Step 1: Implement**

```ts
// packages/benchmarks/src/ops/issueBatch.ts
import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from "viem";
import {
  DiplomaRegistryAbi,
  buildMerkleFromLeaves,
  computeMerkleLeaf,
} from "@univerify/verifier-core";
import type { ChainAdapter, NormalizedMetrics } from "../chains/types.js";
import { now } from "../util/timing.js";

/** Build N synthetic docHashes of the form keccak256(seed||":"||i). Deterministic. */
export function makeSyntheticDocHashes(count: number, seed: string): Hex[] {
  const hashes: Hex[] = [];
  for (let i = 0; i < count; i++) {
    hashes.push(keccak256(toBytes(`${seed}:${i}`)));
  }
  return hashes;
}

/** Compute domain-separated leaves for a given issuer/batchId context. */
export function computeBatchLeaves(params: {
  registry: Address;
  chainId: bigint;
  issuer: Address;
  batchId: bigint;
  docHashes: readonly Hex[];
}): Hex[] {
  return params.docHashes.map((docHash) =>
    computeMerkleLeaf({
      registry: params.registry,
      chainId: params.chainId,
      issuer: params.issuer,
      batchId: params.batchId,
      docHash,
    })
  );
}

export function batchSeed(adapter: ChainAdapter, batchId: bigint): string {
  return `${adapter.name}:${batchId.toString()}`;
}

/** Issue one batch of `batchSize` leaves; return NormalizedMetrics. */
export async function runIssueBatch(
  adapter: ChainAdapter,
  batchSize: number,
  opts: { tag?: "seed" | "main"; nextBatchId: bigint }
): Promise<NormalizedMetrics> {
  const issuer = adapter.walletClient.account!.address as Address;
  const docHashes = makeSyntheticDocHashes(batchSize, batchSeed(adapter, opts.nextBatchId));
  const leaves = computeBatchLeaves({
    registry: adapter.registryAddress,
    chainId: BigInt(adapter.chainId),
    issuer,
    batchId: opts.nextBatchId,
    docHashes,
  });
  const { root } = buildMerkleFromLeaves(leaves);

  const calldata = encodeFunctionData({
    abi: DiplomaRegistryAbi,
    functionName: "issueBatchRoot",
    args: [opts.nextBatchId, root],
  });

  const submittedAt = now();
  const txHash = await adapter.walletClient.sendTransaction({
    to: adapter.registryAddress,
    data: calldata,
    account: adapter.walletClient.account!,
    chain: adapter.walletClient.chain!,
  });

  return adapter.parseReceipt(
    { txHash, calldata, submittedAt },
    "issueBatch",
    { batchSize, tag: opts.tag ?? "main" }
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/ops/issueBatch.ts
git commit -m "feat(benchmarks): add issueBatch operation"
```

---

## Task 12: `revokeBatch` operation

**Files:**
- Create: `packages/benchmarks/src/ops/revokeBatch.ts`

**Background:** `revokeFromBatch(docHash, batchId, proof)` takes the raw `docHash` and the Merkle proof against the batch root. The contract reconstructs the domain-separated leaf from `(registry, chainId, msg.sender, batchId, docHash)`. The burst first issues a seed batch (`SEED_BATCH_SIZE` leaves, tagged `"seed"`), then loops `REVOKE_N` times revoking distinct leaves from it.

- [ ] **Step 1: Implement**

```ts
// packages/benchmarks/src/ops/revokeBatch.ts
import { encodeFunctionData, type Address } from "viem";
import { DiplomaRegistryAbi, buildMerkleFromLeaves } from "@univerify/verifier-core";
import type { ChainAdapter, NormalizedMetrics } from "../chains/types.js";
import { REVOKE_N, SEED_BATCH_SIZE } from "../config.js";
import { now } from "../util/timing.js";
import {
  batchSeed,
  computeBatchLeaves,
  makeSyntheticDocHashes,
  runIssueBatch,
} from "./issueBatch.js";

export type RevokeBurstResult = {
  seed: NormalizedMetrics;
  revokes: NormalizedMetrics[];
};

export async function runRevokeBurst(
  adapter: ChainAdapter,
  nextBatchId: bigint
): Promise<RevokeBurstResult> {
  // 1. Seed batch (tagged; not counted in main issueBatch sweep)
  const seed = await runIssueBatch(adapter, SEED_BATCH_SIZE, {
    tag: "seed",
    nextBatchId,
  });

  // 2. Deterministically rebuild docHashes + leaves + proofs
  const issuer = adapter.walletClient.account!.address as Address;
  const docHashes = makeSyntheticDocHashes(SEED_BATCH_SIZE, batchSeed(adapter, nextBatchId));
  const leaves = computeBatchLeaves({
    registry: adapter.registryAddress,
    chainId: BigInt(adapter.chainId),
    issuer,
    batchId: nextBatchId,
    docHashes,
  });
  const tree = buildMerkleFromLeaves(leaves);

  // 3. REVOKE_N distinct revokes
  const revokes: NormalizedMetrics[] = [];
  for (let i = 0; i < REVOKE_N; i++) {
    const docHash = docHashes[i];
    const proof = tree.proofs[i];
    const calldata = encodeFunctionData({
      abi: DiplomaRegistryAbi,
      functionName: "revokeFromBatch",
      args: [docHash, nextBatchId, proof],
    });

    const submittedAt = now();
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
  return { seed, revokes };
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/ops/revokeBatch.ts
git commit -m "feat(benchmarks): add revokeBatch burst operation"
```

---

## Task 13: `readLatency` operation

**Files:**
- Create: `packages/benchmarks/src/ops/readLatency.ts`

**Background:** `statusWithProof(docHash, issuer, batchId, proof)` is a view call — free, but RPC latency varies per chain. We call it READ_N times against a known-valid (docHash, batchId, issuer, proof) tuple and record per-call latency.

- [ ] **Step 1: Implement**

```ts
// packages/benchmarks/src/ops/readLatency.ts
import type { Address, Hex } from "viem";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";
import type { ChainAdapter, ReadLatencySample } from "../chains/types.js";
import { READ_N } from "../config.js";
import { now } from "../util/timing.js";

/** Call statusWithProof READ_N times, recording per-call latency. */
export async function runReadLatency(
  adapter: ChainAdapter,
  args: { batchId: bigint; docHash: Hex; proof: readonly Hex[]; issuer: Address }
): Promise<ReadLatencySample[]> {
  const samples: ReadLatencySample[] = [];
  for (let i = 0; i < READ_N; i++) {
    const start = now();
    await adapter.publicClient.readContract({
      address: adapter.registryAddress,
      abi: DiplomaRegistryAbi,
      functionName: "statusWithProof",
      args: [args.docHash, args.issuer, args.batchId, args.proof as Hex[]],
    });
    const end = now();
    samples.push({
      chainId: adapter.chainId,
      chainName: adapter.name,
      op: "statusWithProof",
      latencyMs: end - start,
      sampledAt: Date.now(),
    });
  }
  return samples;
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/ops/readLatency.ts
git commit -m "feat(benchmarks): add statusWithProof read-latency op"
```

---

## Task 14: Stage 1 — Deploy

**Files:**
- Create: `packages/benchmarks/src/stages/deploy.ts`

**Background:** Uses Foundry `forge script Deploy.s.sol` per chain. Skips chains whose deployment file already exists (Sepolia already has one committed).

- [ ] **Step 1: Implement**

```ts
// packages/benchmarks/src/stages/deploy.ts
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { CHAIN_IDS, CHAIN_KEYS, RPC_ENV, type ChainKey } from "../config.js";

function deploymentPath(chainId: number): string {
  return path.resolve("contracts", "deployments", `${chainId}.json`);
}

function deployOne(key: ChainKey): void {
  const chainId = CHAIN_IDS[key];
  const p = deploymentPath(chainId);
  if (fs.existsSync(p)) {
    console.log(`[deploy] ${key} (${chainId}) — already deployed, skipping.`);
    return;
  }
  const rpcUrl = process.env[RPC_ENV[key]];
  const pk = process.env.BENCH_PK;
  if (!rpcUrl) throw new Error(`Missing ${RPC_ENV[key]}`);
  if (!pk) throw new Error(`Missing BENCH_PK`);

  console.log(`[deploy] ${key} (${chainId}) — broadcasting...`);
  execSync(
    `forge script script/Deploy.s.sol:Deploy --rpc-url ${rpcUrl} --private-key ${pk} --broadcast`,
    { cwd: path.resolve("contracts"), stdio: "inherit" }
  );
  if (!fs.existsSync(p)) {
    throw new Error(`[deploy] ${key}: Deploy.s.sol did not write ${p}`);
  }
  console.log(`[deploy] ${key} — OK (${p})`);
}

export async function stageDeploy(only?: ChainKey): Promise<void> {
  const keys = only ? [only] : CHAIN_KEYS;
  for (const key of keys) deployOne(key);
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/stages/deploy.ts
git commit -m "feat(benchmarks): add Stage 1 deploy wrapper"
```

---

## Task 15: Stage 3 — Price history

**Files:**
- Create: `packages/benchmarks/src/stages/price.ts`
- Create: `packages/benchmarks/tests/fixtures/price-history/tiny-prices.json`
- Test: `packages/benchmarks/tests/stages/price.test.ts`

**Background:** Fetches Ethereum L1 basefees for the last 90 days from a public API. We use `eth_feeHistory` via a public RPC (no API key) — it returns per-block baseFeePerGas. We sample one block every N blocks to limit data volume, then compute p10/p50/p90 over the sample.

- [ ] **Step 1: Create fixture**

`packages/benchmarks/tests/fixtures/price-history/tiny-prices.json`:

```json
{
  "source": "eth_feeHistory",
  "fetchedAt": "2026-04-19T12:00:00Z",
  "windowDays": 90,
  "samples": [
    { "blockNumber": 100, "baseFeePerGas": "10000000000" },
    { "blockNumber": 200, "baseFeePerGas": "20000000000" },
    { "blockNumber": 300, "baseFeePerGas": "30000000000" },
    { "blockNumber": 400, "baseFeePerGas": "40000000000" },
    { "blockNumber": 500, "baseFeePerGas": "50000000000" }
  ]
}
```

- [ ] **Step 2: Write failing test**

```ts
// packages/benchmarks/tests/stages/price.test.ts
import { describe, it, expect } from "vitest";
import tiny from "../fixtures/price-history/tiny-prices.json" with { type: "json" };
import { derivePercentiles } from "../../src/stages/price.js";

describe("derivePercentiles", () => {
  it("returns p10/p50/p90 of sampled basefees in wei (bigint)", () => {
    const { p10, p50, p90 } = derivePercentiles(tiny);
    expect(p10).toBe(10_000_000_000n);
    expect(p50).toBe(30_000_000_000n);
    expect(p90).toBe(50_000_000_000n);
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm -w @univerify/benchmarks test -- tests/stages/price.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement price stage**

```ts
// packages/benchmarks/src/stages/price.ts
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, type PublicClient } from "viem";
import { mainnet } from "viem/chains";

export type PriceSample = { blockNumber: number; baseFeePerGas: string };
export type PriceHistory = {
  source: string;
  fetchedAt: string;
  windowDays: number;
  samples: PriceSample[];
};

export type Percentiles = { p10: bigint; p50: bigint; p90: bigint };

export function derivePercentiles(h: PriceHistory): Percentiles {
  const bigs = h.samples.map((s) => BigInt(s.baseFeePerGas)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const pick = (p: number) => bigs[Math.min(bigs.length - 1, Math.floor(p * bigs.length))];
  return { p10: pick(0.1), p50: pick(0.5), p90: pick(0.9) };
}

const BLOCKS_PER_DAY = 7200; // mainnet, ~12s blocks
const WINDOW_DAYS = 90;
const SAMPLE_STRIDE = BLOCKS_PER_DAY; // one sample per day

async function fetchBasefeeHistory(rpcUrl: string): Promise<PriceHistory> {
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  const latest = await client.getBlockNumber();
  const samples: PriceSample[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const bn = latest - BigInt(i) * BigInt(SAMPLE_STRIDE);
    if (bn <= 0n) break;
    const block = await client.getBlock({ blockNumber: bn });
    if (block.baseFeePerGas == null) continue;
    samples.push({ blockNumber: Number(bn), baseFeePerGas: block.baseFeePerGas.toString() });
  }
  return {
    source: "eth_getBlockByNumber",
    fetchedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    samples,
  };
}

export async function stagePrice(): Promise<string> {
  const outDir = path.resolve("benchmarks", "price-history");
  fs.mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `${today}.json`);
  if (fs.existsSync(outPath)) {
    console.log(`[price] ${outPath} already exists — reusing.`);
    return outPath;
  }
  const rpcUrl = process.env.RPC_MAINNET;
  if (!rpcUrl) throw new Error("RPC_MAINNET is not set (public RPC is fine).");
  console.log(`[price] fetching 90-day basefee history from ${rpcUrl}...`);
  const hist = await fetchBasefeeHistory(rpcUrl);
  fs.writeFileSync(outPath, JSON.stringify(hist, null, 2));
  console.log(`[price] wrote ${outPath} (${hist.samples.length} samples)`);
  return outPath;
}

export function readPriceHistory(p: string): PriceHistory {
  return JSON.parse(fs.readFileSync(p, "utf8")) as PriceHistory;
}

export function newestPriceHistoryPath(): string | null {
  const dir = path.resolve("benchmarks", "price-history");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}
```

- [ ] **Step 5: Run test to verify passing**

Run: `npm -w @univerify/benchmarks test -- tests/stages/price.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/stages/price.ts packages/benchmarks/tests/stages/price.test.ts packages/benchmarks/tests/fixtures/price-history/tiny-prices.json
git commit -m "feat(benchmarks): add Stage 3 price history fetch + percentile derivation"
```

---

## Task 16: Stage 4 — Export (tables)

**Files:**
- Create: `packages/benchmarks/src/stages/export.ts`
- Create: `packages/benchmarks/tests/fixtures/results/tiny-run.json`
- Test: `packages/benchmarks/tests/stages/export.test.ts`

**Background:** The exporter reads one `results/<run-id>.json` and one `price-history/<date>.json`, emitting 5 CSVs (tables) and 4 `.dat` files (figures). This task delivers CSV tables + minimal scaffolding; figure emission is Task 17.

- [ ] **Step 1: Create synthetic results fixture**

`packages/benchmarks/tests/fixtures/results/tiny-run.json`:

```json
{
  "runId": "20260419T120000-beef",
  "measuredAt": "2026-04-19T12:00:00Z",
  "chains": {
    "sepolia": {
      "issueBatch": [
        { "chainId": 11155111, "chainName": "sepolia", "op": "issueBatch", "batchSize": 1, "tag": "main", "gasUsed": "55000", "effectiveGasPrice": "30000000000", "l1DataFee": "0", "calldataBytes": 68, "blockNumber": "100", "txHash": "0xaa", "submittedAt": 0, "includedAt": 100, "inclusionLatencyMs": 100 },
        { "chainId": 11155111, "chainName": "sepolia", "op": "issueBatch", "batchSize": 100, "tag": "main", "gasUsed": "55000", "effectiveGasPrice": "30000000000", "l1DataFee": "0", "calldataBytes": 68, "blockNumber": "101", "txHash": "0xab", "submittedAt": 0, "includedAt": 120, "inclusionLatencyMs": 120 }
      ],
      "revokeFromBatch": [],
      "readLatency": []
    },
    "baseSepolia": {
      "issueBatch": [
        { "chainId": 84532, "chainName": "baseSepolia", "op": "issueBatch", "batchSize": 1, "tag": "main", "gasUsed": "55000", "effectiveGasPrice": "100000", "l1DataFee": "1500000000000", "l1GasUsed": "10000", "calldataBytes": 68, "blockNumber": "100", "txHash": "0xbb", "submittedAt": 0, "includedAt": 200, "inclusionLatencyMs": 200 },
        { "chainId": 84532, "chainName": "baseSepolia", "op": "issueBatch", "batchSize": 100, "tag": "main", "gasUsed": "55000", "effectiveGasPrice": "100000", "l1DataFee": "1500000000000", "l1GasUsed": "10000", "calldataBytes": 68, "blockNumber": "101", "txHash": "0xbc", "submittedAt": 0, "includedAt": 220, "inclusionLatencyMs": 220 }
      ],
      "revokeFromBatch": [],
      "readLatency": []
    }
  }
}
```

- [ ] **Step 2: Write failing test**

```ts
// packages/benchmarks/tests/stages/export.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import tiny from "../fixtures/results/tiny-run.json" with { type: "json" };
import tinyPrices from "../fixtures/price-history/tiny-prices.json" with { type: "json" };
import { writeIssueCostTable } from "../../src/stages/export.js";

describe("writeIssueCostTable", () => {
  it("emits CSV with one row per chain and one column per batch size", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const csvPath = writeIssueCostTable(tiny as never, tinyPrices as never, tmp);
      const csv = fs.readFileSync(csvPath, "utf8");
      expect(csv.split("\n")[0]).toContain("chain");
      expect(csv).toContain("sepolia");
      expect(csv).toContain("baseSepolia");
      // p50 of tinyPrices = 30 gwei → USD column present
      expect(csv).toMatch(/usd_p50/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run test to verify failure**

Run: `npm -w @univerify/benchmarks test -- tests/stages/export.test.ts`
Expected: FAIL.

- [ ] **Step 4: Implement export table emission**

```ts
// packages/benchmarks/src/stages/export.ts
import fs from "node:fs";
import path from "node:path";
import type { Hex } from "viem";
import type { NormalizedMetrics, ReadLatencySample } from "../chains/types.js";
import { BATCH_SIZES } from "../config.js";
import { derivePercentiles, type PriceHistory } from "./price.js";

// --- result envelope written by Stage 2 -----------------------------------
export type PerChainResults = {
  issueBatch: NormalizedMetrics[];
  revokeFromBatch: NormalizedMetrics[];
  readLatency: ReadLatencySample[];
};
export type RunResults = {
  runId: string;
  measuredAt: string;
  chains: Record<string, PerChainResults>;
};

// --- Cost model -----------------------------------------------------------
/** ETH price in USD used for USD-cost columns. Sourced separately; hard-coded for now. */
export const ETH_USD = 3500;

function totalCostWei(m: NormalizedMetrics, basefeeWei: bigint): bigint {
  // gasUsed × basefee (modelled L1 price) + l1DataFee (already in wei, measured)
  return m.gasUsed * basefeeWei + m.l1DataFee;
}

function weiToUsd(wei: bigint): number {
  const eth = Number(wei) / 1e18;
  return eth * ETH_USD;
}

// --- Tables ---------------------------------------------------------------
export function writeIssueCostTable(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p10, p50, p90 } = derivePercentiles(prices);
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, "table-issue-cost.csv");

  const sizeCols = [...BATCH_SIZES];
  const header = [
    "chain",
    ...sizeCols.map((s) => `gas_${s}`),
    ...sizeCols.map((s) => `l1data_wei_${s}`),
    ...sizeCols.map((s) => `usd_p10_${s}`),
    ...sizeCols.map((s) => `usd_p50_${s}`),
    ...sizeCols.map((s) => `usd_p90_${s}`),
  ].join(",");

  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    const byBatch = new Map<number, NormalizedMetrics>();
    for (const m of data.issueBatch) {
      if (m.tag !== "main" || m.batchSize == null) continue;
      byBatch.set(m.batchSize, m);
    }
    const gas = sizeCols.map((s) => (byBatch.get(s)?.gasUsed ?? 0n).toString());
    const l1 = sizeCols.map((s) => (byBatch.get(s)?.l1DataFee ?? 0n).toString());
    const u10 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, p10)).toFixed(6) : "";
    });
    const u50 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, p50)).toFixed(6) : "";
    });
    const u90 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, p90)).toFixed(6) : "";
    });
    rows.push([chain, ...gas, ...l1, ...u10, ...u50, ...u90].join(","));
  }

  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeIssuePerDiplomaTable(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p50 } = derivePercentiles(prices);
  const csvPath = path.join(outDir, "table-issue-per-diploma.csv");
  const sizeCols = [...BATCH_SIZES];
  const header = ["chain", ...sizeCols.map((s) => `usd_p50_per_diploma_${s}`)].join(",");
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    const byBatch = new Map<number, NormalizedMetrics>();
    for (const m of data.issueBatch) {
      if (m.tag !== "main" || m.batchSize == null) continue;
      byBatch.set(m.batchSize, m);
    }
    const values = sizeCols.map((s) => {
      const m = byBatch.get(s);
      if (!m || m.batchSize == null) return "";
      return (weiToUsd(totalCostWei(m, p50)) / m.batchSize).toFixed(9);
    });
    rows.push([chain, ...values].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeRevokeCostTable(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p50 } = derivePercentiles(prices);
  const csvPath = path.join(outDir, "table-revoke-cost.csv");
  const header = "chain,median_gas,median_l1data_wei,usd_p50";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.revokeFromBatch.length === 0) continue;
    const sorted = [...data.revokeFromBatch].sort((a, b) =>
      a.gasUsed < b.gasUsed ? -1 : a.gasUsed > b.gasUsed ? 1 : 0
    );
    const mid = sorted[Math.floor(sorted.length / 2)];
    const usd = weiToUsd(totalCostWei(mid, p50));
    rows.push([chain, mid.gasUsed, mid.l1DataFee, usd.toFixed(6)].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeReadLatencyTable(run: RunResults, outDir: string): string {
  const csvPath = path.join(outDir, "table-read-latency.csv");
  const header = "chain,p50_ms,p95_ms,p99_ms,max_ms";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.readLatency.length === 0) continue;
    const s = data.readLatency.map((x) => x.latencyMs).sort((a, b) => a - b);
    const pick = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    rows.push([chain, pick(0.5), pick(0.95), pick(0.99), s[s.length - 1]].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeInclusionLatencyTable(run: RunResults, outDir: string): string {
  const csvPath = path.join(outDir, "table-inclusion-latency.csv");
  const header = "chain,p50_ms,p95_ms";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.revokeFromBatch.length === 0) continue;
    const s = data.revokeFromBatch.map((x) => x.inclusionLatencyMs).sort((a, b) => a - b);
    const pick = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    rows.push([chain, pick(0.5), pick(0.95)].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}
```

- [ ] **Step 5: Run test to verify passing**

Run: `npm -w @univerify/benchmarks test -- tests/stages/export.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/benchmarks/src/stages/export.ts packages/benchmarks/tests/stages/export.test.ts packages/benchmarks/tests/fixtures/results/tiny-run.json
git commit -m "feat(benchmarks): add Stage 4 export — CSV tables"
```

---

## Task 17: Stage 4 — Figures (`.dat`) + `meta.json` + stage driver

**Files:**
- Modify: `packages/benchmarks/src/stages/export.ts`
- Modify: `packages/benchmarks/tests/stages/export.test.ts`

- [ ] **Step 1: Add figure-emitting functions**

Append to `packages/benchmarks/src/stages/export.ts`:

```ts
// --- Figures --------------------------------------------------------------

export function writeFigCostPerDiploma(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p50 } = derivePercentiles(prices);
  const datPath = path.join(outDir, "fig1-cost-per-diploma.dat");
  const sizeCols = [...BATCH_SIZES];
  const header = ["batchSize", ...Object.keys(run.chains)].join(" ");
  const rows: string[] = [];
  for (const s of sizeCols) {
    const cols: string[] = [String(s)];
    for (const chain of Object.keys(run.chains)) {
      const m = run.chains[chain].issueBatch.find(
        (x) => x.tag === "main" && x.batchSize === s
      );
      cols.push(m ? (weiToUsd(totalCostWei(m, p50)) / s).toFixed(12) : "nan");
    }
    rows.push(cols.join(" "));
  }
  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

export function writeFigGasVsL1Data(
  run: RunResults,
  outDir: string
): string {
  const datPath = path.join(outDir, "fig2-gas-vs-l1data.dat");
  const header = "chain execution_wei l1data_wei";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    const m = data.issueBatch.find((x) => x.tag === "main" && x.batchSize === 1000);
    if (!m) continue;
    const exec = m.gasUsed * m.effectiveGasPrice;
    rows.push([chain, exec, m.l1DataFee].join(" "));
  }
  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

export function writeFigReadLatencyCdf(run: RunResults, outDir: string): string {
  const datPath = path.join(outDir, "fig3-read-latency-cdf.dat");
  const chains = Object.keys(run.chains);
  const series = chains.map((c) =>
    run.chains[c].readLatency.map((x) => x.latencyMs).sort((a, b) => a - b)
  );
  const maxLen = Math.max(0, ...series.map((s) => s.length));
  const header = ["rank", ...chains].join(" ");
  const rows: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const cols: string[] = [String(i + 1)];
    for (const s of series) cols.push(i < s.length ? s[i].toFixed(2) : "nan");
    rows.push(cols.join(" "));
  }
  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

export function writeFigBasefeeScenarios(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p10, p50, p90 } = derivePercentiles(prices);
  const datPath = path.join(outDir, "fig4-basefee-scenarios.dat");
  const header = "chain quiet_usd normal_usd congested_usd";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    const m = data.issueBatch.find((x) => x.tag === "main" && x.batchSize === 1000);
    if (!m) continue;
    rows.push(
      [
        chain,
        weiToUsd(totalCostWei(m, p10)).toFixed(6),
        weiToUsd(totalCostWei(m, p50)).toFixed(6),
        weiToUsd(totalCostWei(m, p90)).toFixed(6),
      ].join(" ")
    );
  }
  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

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
    chains: Object.keys(run.chains),
  };
  fs.writeFileSync(outPath, JSON.stringify(meta, null, 2));
  return outPath;
}

// --- Stage driver ---------------------------------------------------------

export type StageExportOpts = { resultsPath?: string; pricesPath?: string };

export function stageExport(opts: StageExportOpts = {}): void {
  const resultsPath = opts.resultsPath ?? newestResultsPath();
  if (!resultsPath) throw new Error("no results file in benchmarks/results/");
  const pricesPath = opts.pricesPath ?? newestPriceHistoryPathLocal();
  if (!pricesPath)
    throw new Error(
      "no price history in benchmarks/price-history/ — run `benchmarks price` first"
    );
  const run = JSON.parse(fs.readFileSync(resultsPath, "utf8")) as RunResults;
  const prices = JSON.parse(fs.readFileSync(pricesPath, "utf8")) as PriceHistory;
  const outDir = path.resolve("docs", "l2-benchmarks", "data");
  writeIssueCostTable(run, prices, outDir);
  writeIssuePerDiplomaTable(run, prices, outDir);
  writeRevokeCostTable(run, prices, outDir);
  writeReadLatencyTable(run, outDir);
  writeInclusionLatencyTable(run, outDir);
  writeFigCostPerDiploma(run, prices, outDir);
  writeFigGasVsL1Data(run, outDir);
  writeFigReadLatencyCdf(run, outDir);
  writeFigBasefeeScenarios(run, prices, outDir);
  writeMeta(run, pricesPath, outDir);
  console.log(`[export] wrote 10 files under ${outDir}`);
}

function newestResultsPath(): string | null {
  const dir = path.resolve("benchmarks", "results");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".partial.json"))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}

function newestPriceHistoryPathLocal(): string | null {
  const dir = path.resolve("benchmarks", "price-history");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}
```

- [ ] **Step 2: Add figure test**

Append to `packages/benchmarks/tests/stages/export.test.ts`:

```ts
import { writeFigCostPerDiploma, writeFigGasVsL1Data } from "../../src/stages/export.js";

describe("figure emission", () => {
  it("writes fig1 dat with one row per batch size", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const datPath = writeFigCostPerDiploma(tiny as never, tinyPrices as never, tmp);
      const lines = fs.readFileSync(datPath, "utf8").trim().split("\n");
      // header + 5 batch sizes
      expect(lines.length).toBe(6);
      expect(lines[0]).toMatch(/batchSize/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes fig2 dat with one row per chain that has a 1000-size sample", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const datPath = writeFigGasVsL1Data(tiny as never, tmp);
      const content = fs.readFileSync(datPath, "utf8");
      // tiny-run has only size=1 and size=100 — fig2 is empty of data rows
      expect(content.trim().split("\n").length).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npm -w @univerify/benchmarks test -- tests/stages/export.test.ts`
Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/benchmarks/src/stages/export.ts packages/benchmarks/tests/stages/export.test.ts
git commit -m "feat(benchmarks): add Stage 4 figures, meta.json, and export driver"
```

---

## Task 18: Stage 2 — Measure orchestrator

**Files:**
- Create: `packages/benchmarks/src/stages/measure.ts`

**Background:** The orchestrator runs issueSweep + revokeBurst + readLatency on each chain, merging into one run file. On RPC failure it saves `.partial.json` and allows `--resume=<run-id>`. For **each** chain it:
1. reads next `batchId` from the contract (via `getBatch` loop or a known counter view)
2. runs `issueSweep` (batch sizes from config; tag `"main"`)
3. runs `revokeBurst` (seed + REVOKE_N revokes)
4. runs `readLatency` (against the seed batch's first leaf)

Pre-flight: check wallet balance per chain.

- [ ] **Step 1: Implement**

```ts
// packages/benchmarks/src/stages/measure.ts
import fs from "node:fs";
import path from "node:path";
import { keccak256, toBytes, type Hex } from "viem";
import { buildMerkleFromLeaves } from "@univerify/verifier-core";
import { DiplomaRegistryAbi, buildMerkleFromLeaves } from "@univerify/verifier-core";
import { getAdapter } from "../chains/index.js";
import type { ChainAdapter, NormalizedMetrics, ReadLatencySample } from "../chains/types.js";
import {
  BATCH_SIZES,
  CHAIN_KEYS,
  FAUCETS,
  SEED_BATCH_SIZE,
  type ChainKey,
} from "../config.js";
import { loadBenchAccount } from "../util/wallet.js";
import { newRunId } from "../util/runId.js";
import {
  batchSeed,
  computeBatchLeaves,
  makeSyntheticDocHashes,
  runIssueBatch,
} from "../ops/issueBatch.js";
import { runRevokeBurst } from "../ops/revokeBatch.js";
import { runReadLatency } from "../ops/readLatency.js";
import type { PerChainResults, RunResults } from "./export.js";

const RESULTS_DIR = path.resolve("benchmarks", "results");
const ZERO_BYTES32: Hex =
  "0x0000000000000000000000000000000000000000000000000000000000000000";

async function checkBalance(adapter: ChainAdapter, key: ChainKey): Promise<void> {
  const bal = await adapter.publicClient.getBalance({
    address: adapter.walletClient.account!.address,
  });
  const minWei = 1_000_000_000_000_000n; // 0.001 ETH sanity floor
  if (bal < minWei) {
    throw new Error(
      `[measure] ${key}: wallet ${adapter.walletClient.account!.address} has ${bal} wei (< 0.001 ETH). Faucet: ${FAUCETS[key]}`
    );
  }
}

async function nextBatchId(adapter: ChainAdapter): Promise<bigint> {
  // Issuer-scoped batchId: scan from 0 until getBatch returns the zero root.
  const issuer = adapter.walletClient.account!.address;
  let id = 0n;
  for (;;) {
    const root = (await adapter.publicClient.readContract({
      address: adapter.registryAddress,
      abi: DiplomaRegistryAbi,
      functionName: "getBatch",
      args: [issuer, id],
    })) as Hex;
    if (root === ZERO_BYTES32) return id;
    id += 1n;
  }
}

export type MeasureOpts = { only?: ChainKey; resume?: string };

export async function stageMeasure(opts: MeasureOpts = {}): Promise<string> {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const account = loadBenchAccount();
  const keys = opts.only ? [opts.only] : CHAIN_KEYS;

  const runId = opts.resume ?? newRunId();
  const partialPath = path.join(RESULTS_DIR, `${runId}.partial.json`);
  const finalPath = path.join(RESULTS_DIR, `${runId}.json`);

  const run: RunResults = fs.existsSync(partialPath)
    ? (JSON.parse(fs.readFileSync(partialPath, "utf8")) as RunResults)
    : { runId, measuredAt: new Date().toISOString(), chains: {} };

  for (const key of keys) {
    if (run.chains[key]) {
      console.log(`[measure] ${key} already present in run — skipping.`);
      continue;
    }
    const adapter = getAdapter(key, account);
    await checkBalance(adapter, key);

    const perChain: PerChainResults = {
      issueBatch: [],
      revokeFromBatch: [],
      readLatency: [],
    };

    // issue sweep — main
    let nextId = await nextBatchId(adapter);
    for (const size of BATCH_SIZES) {
      console.log(`[measure] ${key} issueBatch(${size}) batchId=${nextId}`);
      const m = await runIssueBatch(adapter, size, { tag: "main", nextBatchId: nextId });
      perChain.issueBatch.push(m);
      nextId += 1n;
    }

    // revoke burst (seed + revokes)
    console.log(`[measure] ${key} revoke burst (seed batchId=${nextId})`);
    const burst = await runRevokeBurst(adapter, nextId);
    perChain.issueBatch.push(burst.seed);
    perChain.revokeFromBatch.push(...burst.revokes);
    const seedBatchId = nextId;
    nextId += 1n;

    // read latency against seed batch, docHash 0
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
    const reads: ReadLatencySample[] = await runReadLatency(adapter, {
      batchId: seedBatchId,
      docHash: seedDocHashes[0],
      proof: tree.proofs[0],
      issuer,
    });
    perChain.readLatency = reads;

    run.chains[key] = perChain;
    fs.writeFileSync(partialPath, stringify(run));
  }

  // promote partial → final
  fs.writeFileSync(finalPath, stringify(run));
  fs.unlinkSync(partialPath);
  console.log(`[measure] wrote ${finalPath}`);
  return finalPath;
}

function stringify(obj: unknown): string {
  return JSON.stringify(
    obj,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/stages/measure.ts
git commit -m "feat(benchmarks): add Stage 2 measure orchestrator with resume"
```

---

## Task 19: CLI entry + smoke command

**Files:**
- Modify: `packages/benchmarks/src/index.ts` (replace placeholder)

- [ ] **Step 1: Write CLI**

Overwrite `packages/benchmarks/src/index.ts`:

```ts
#!/usr/bin/env node
import { stageDeploy } from "./stages/deploy.js";
import { stageMeasure } from "./stages/measure.js";
import { stagePrice } from "./stages/price.js";
import { stageExport } from "./stages/export.js";
import type { ChainKey } from "./config.js";

function argValue(args: string[], flag: string): string | undefined {
  const match = args.find((a) => a.startsWith(`--${flag}=`));
  return match?.slice(flag.length + 3);
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  switch (command) {
    case "deploy": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      await stageDeploy(only);
      return;
    }
    case "price": {
      await stagePrice();
      return;
    }
    case "measure": {
      const only = argValue(rest, "chain") as ChainKey | undefined;
      const resume = argValue(rest, "resume");
      await stageMeasure({ only, resume });
      return;
    }
    case "export": {
      const resultsPath = argValue(rest, "results");
      const pricesPath = argValue(rest, "prices");
      stageExport({ resultsPath, pricesPath });
      return;
    }
    case "all": {
      await stageMeasure({});
      await stagePrice();
      stageExport({});
      return;
    }
    case "smoke": {
      const only = (argValue(rest, "chain") as ChainKey | undefined) ?? "sepolia";
      await stageMeasure({ only });
      await stagePrice();
      stageExport({});
      return;
    }
    default:
      console.error(
        "Usage: benchmarks {deploy|measure|price|export|all|smoke} [--chain=KEY] [--resume=RUN_ID]"
      );
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/benchmarks/src/index.ts
git commit -m "feat(benchmarks): add CLI entry with subcommands"
```

---

## Task 20: Root npm scripts

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add scripts**

In the root `package.json`, inside the `scripts` block, add:

```json
"benchmarks:deploy": "npm -w @univerify/benchmarks run deploy",
"benchmarks:measure": "npm -w @univerify/benchmarks run measure",
"benchmarks:price": "npm -w @univerify/benchmarks run price",
"benchmarks:export": "npm -w @univerify/benchmarks run export",
"benchmarks:all": "npm -w @univerify/benchmarks run all",
"benchmarks:smoke": "npm -w @univerify/benchmarks run smoke"
```

Also update the root `build` script to include benchmarks after `sdk`:

```json
"build": "npm -w @univerify/verifier-core run build && npm -w @univerify/sdk run build && npm -w @univerify/verifier-cli run build && npm -w @univerify/benchmarks run build && npm -w web run build",
```

- [ ] **Step 2: Verify `npm run build` still passes**

Run: `npm run build`
Expected: all six packages build, including `@univerify/benchmarks`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(benchmarks): add root-level npm scripts"
```

---

## Task 21: LaTeX chapter skeleton

**Files:**
- Create: `docs/univerify-l2-benchmarks.tex`

**Background:** Matches the Polish academic style of `docs/univerify-gas-experiments.tex`. Imports tables via `\csvautotabular` and figures via `\addplot table`. Reads `meta.json` for the "measured on" footnote.

- [ ] **Step 1: Write the skeleton**

```latex
\documentclass[11pt,a4paper]{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[polish]{babel}
\usepackage{lmodern}
\usepackage{geometry}
\usepackage{booktabs}
\usepackage{siunitx}
\usepackage{pgfplots}
\usepackage{pgfplotstable}
\usepackage{csvsimple}
\usepackage{hyperref}
\usepackage{caption}
\usepackage{float}

\pgfplotsset{compat=1.18}
\geometry{margin=2.2cm}
\sisetup{group-separator={\,}}

\newcommand{\DataDir}{l2-benchmarks/data}

\title{\textbf{UniVerify: Benchmarki warstwy 2\\w rejestrze dyplomów opartym na Ethereum}\\[0.6em]
\large Porównanie Sepolia, Arbitrum, Base oraz zkSync}
\author{Nazar Shcherbyna \\ Praca magisterska}
\date{Pomiar wykonano: \input{\DataDir/measured-at.tex}\unskip}

\begin{document}
\maketitle
\tableofcontents
\newpage

\section{Wprowadzenie}
Niniejszy rozdział porównuje koszt uruchomienia kontraktu \texttt{DiplomaRegistry}
na czterech sieciach Ethereum: warstwie pierwszej (Sepolia, jako punkt odniesienia)
oraz trzech rozwiązaniach warstwy drugiej reprezentujących różne rodziny
(Arbitrum Nitro, Base jako przedstawiciel OP-stack, zkSync Era jako rollup z dowodami zwięzłości).

\section{Metodologia}
\subsection{Pomiary}
Każda sieć mierzona jest na sieci testowej: \emph{zużycie gazu} i
\emph{opłata za dane L1} są wielkościami rzeczywistymi,
natomiast koszty w USD są modelowane z~historycznych wartości \texttt{baseFeePerGas}
warstwy pierwszej z ostatnich 90 dni (percentyle p10/p50/p90).

\subsection{Parametry próby}
Dla \texttt{issueBatch} użyto rozmiarów paczek
$\{1, 10, 100, 1\,000, 10\,000\}$. Dla \texttt{revokeFromBatch}
zebrano 30 próbek przeciwko paczce seed o rozmiarze 40.
Dla \texttt{statusWithProof} zebrano 100 próbek czasu odpowiedzi RPC.

\section{Wyniki: koszt \texttt{issueBatch}}
\begin{table}[H]
  \centering
  \caption{Tabela 1: Koszt \texttt{issueBatch} według sieci i rozmiaru paczki.}
  \csvautotabular{\DataDir/table-issue-cost.csv}
\end{table}

\begin{table}[H]
  \centering
  \caption{Tabela 2: Koszt na dyplom (amortyzacja paczki) w USD, scenariusz p50.}
  \csvautotabular{\DataDir/table-issue-per-diploma.csv}
\end{table}

\begin{figure}[H]
  \centering
  \begin{tikzpicture}
    \begin{loglogaxis}[
      xlabel={Rozmiar paczki (liczba dyplomów)},
      ylabel={Koszt na dyplom (USD)},
      legend pos=north east,
      grid=major,
      width=0.85\textwidth,
      height=8cm,
    ]
      \addplot table[x=batchSize, y=sepolia] {\DataDir/fig1-cost-per-diploma.dat};
      \addplot table[x=batchSize, y=arbitrumSepolia] {\DataDir/fig1-cost-per-diploma.dat};
      \addplot table[x=batchSize, y=baseSepolia] {\DataDir/fig1-cost-per-diploma.dat};
      \addplot table[x=batchSize, y=zksyncSepolia] {\DataDir/fig1-cost-per-diploma.dat};
      \legend{Sepolia L1, Arbitrum Sepolia, Base Sepolia, zkSync Sepolia}
    \end{loglogaxis}
  \end{tikzpicture}
  \caption{Rys. 1: Koszt na dyplom w funkcji rozmiaru paczki (skala log-log, scenariusz p50).}
\end{figure}

\section{Wyniki: koszt \texttt{revokeFromBatch}}
\begin{table}[H]
  \centering
  \caption{Tabela 3: Koszt \texttt{revokeFromBatch} (pojedyncza transakcja, mediana).}
  \csvautotabular{\DataDir/table-revoke-cost.csv}
\end{table}

\section{Wyniki: latencja}
\begin{table}[H]
  \centering
  \caption{Tabela 4: Latencja odczytu \texttt{statusWithProof}.}
  \csvautotabular{\DataDir/table-read-latency.csv}
\end{table}

\begin{table}[H]
  \centering
  \caption{Tabela 5: Latencja inkluzji transakcji zapisu.}
  \csvautotabular{\DataDir/table-inclusion-latency.csv}
\end{table}

\section{Wyniki: wrażliwość na scenariusze basefee}
\begin{figure}[H]
  \centering
  \begin{tikzpicture}
    \begin{axis}[
      ybar,
      symbolic x coords={sepolia, arbitrumSepolia, baseSepolia, zksyncSepolia},
      xtick=data,
      ylabel={Koszt \texttt{issueBatch(1000)} (USD)},
      bar width=10pt,
      legend pos=north west,
      width=0.85\textwidth,
      height=8cm,
    ]
      \addplot table[x=chain, y=quiet_usd] {\DataDir/fig4-basefee-scenarios.dat};
      \addplot table[x=chain, y=normal_usd] {\DataDir/fig4-basefee-scenarios.dat};
      \addplot table[x=chain, y=congested_usd] {\DataDir/fig4-basefee-scenarios.dat};
      \legend{p10 (quiet), p50 (normal), p90 (congested)}
    \end{axis}
  \end{tikzpicture}
  \caption{Rys. 4: Koszt \texttt{issueBatch(1000)} przy scenariuszach basefee p10/p50/p90.}
\end{figure}

\section{Dyskusja}
\paragraph{Ograniczenia pomiaru.}
Ceny gazu zostały wzięte z historycznych wartości mainnet; same transakcje
wykonano na sieciach testowych. Dla zkSync opłata za dane L1 nie jest wyodrębniona
na paragonie — koszt publikacji jest wliczony w \texttt{gasUsed}.

\paragraph{Wniosek.}
\dots{}

\end{document}
```

- [ ] **Step 2: Add `measured-at.tex` helper emission to exporter**

Add this function to `packages/benchmarks/src/stages/export.ts` and call it inside `stageExport`:

```ts
export function writeMeasuredAt(run: RunResults, outDir: string): string {
  const p = path.join(outDir, "measured-at.tex");
  fs.writeFileSync(p, run.measuredAt);
  return p;
}
```

Inside `stageExport`, add after `writeMeta(...)`:

```ts
writeMeasuredAt(run, outDir);
```

- [ ] **Step 3: Verify compilation**

Run: `npm -w @univerify/benchmarks run build`
Expected: succeeds.

- [ ] **Step 4: Commit**

```bash
git add docs/univerify-l2-benchmarks.tex packages/benchmarks/src/stages/export.ts
git commit -m "docs(benchmarks): add L2 benchmarks LaTeX chapter skeleton"
```

---

## Task 22: README

**Files:**
- Modify: `packages/benchmarks/README.md`

- [ ] **Step 1: Replace stub with full README**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add packages/benchmarks/README.md
git commit -m "docs(benchmarks): add full README with setup and usage"
```

---

## Task 23: Final verification — full test suite

**Files:** none (verification only)

- [ ] **Step 1: Build everything**

Run: `npm run build`
Expected: all packages build in the order `verifier-core → sdk → cli → benchmarks → web`. No errors.

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: `verifier-core`, `web`, and `benchmarks` projects all pass.

- [ ] **Step 3: Verify CLI help renders**

Run: `npm -w @univerify/benchmarks run start -- --help 2>&1 || true`
Expected: the usage line is printed (unknown command → usage).

- [ ] **Step 4: If any step failed, fix and re-commit**

Loop back to the failing task. Commit fixes with descriptive messages.

---

## Execution Notes

- **TDD discipline:** each adapter + stage includes a failing test first. Do not skip the FAIL step — it validates the test actually asserts behavior.
- **One commit per task, minimum.** If a task has multiple logical commits (e.g., test + implementation), that's fine — don't squash.
- **Type bigints carefully:** JSON serialisation requires the `stringify` helper in `measure.ts`. If you hand-roll `JSON.stringify(x)` on a bigint anywhere, the build will fail at runtime.
- **Rollback:** if Phase 2 needs to be abandoned, delete `packages/benchmarks/`, `benchmarks/`, `docs/l2-benchmarks/`, `docs/univerify-l2-benchmarks.tex`, and revert the root `package.json` and `vitest.config.ts` edits. Product code under `apps/`, `packages/sdk/`, `packages/verifier-core/`, `packages/verifier-cli/`, and `contracts/` is untouched.
