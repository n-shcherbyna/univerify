// packages/benchmarks/src/stages/measure.ts
import fs from "node:fs";
import path from "node:path";
import { keccak256, toBytes, type Hex } from "viem";
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
