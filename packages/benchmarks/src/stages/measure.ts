// packages/benchmarks/src/stages/measure.ts
import fs from "node:fs";
import path from "node:path";
import { type Hex } from "viem";
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
import { atomicWriteJson } from "../util/atomicWrite.js";
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
import { resumeNeedsOp, markComplete, type ResumeProgress } from "./measureResume.js";
import { findNextBatchId } from "./nextBatchId.js";

const RESULTS_DIR = path.resolve("benchmarks", "results");

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

export type MeasureOpts = { only?: ChainKey; resume?: string };

export async function stageMeasure(opts: MeasureOpts = {}): Promise<string> {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const account = loadBenchAccount();
  const keys = opts.only ? [opts.only] : CHAIN_KEYS;

  const runId = opts.resume ?? newRunId();
  const partialPath = path.join(RESULTS_DIR, `${runId}.partial.json`);
  const finalPath = path.join(RESULTS_DIR, `${runId}.json`);

  const onInterrupt = () => {
    console.log(`\n[measure] interrupted — partial state preserved at ${partialPath}`);
    process.exit(130);
  };
  process.once("SIGINT", onInterrupt);
  process.once("SIGTERM", onInterrupt);

  const run: RunResults & { progress?: ResumeProgress } = fs.existsSync(partialPath)
    ? (JSON.parse(fs.readFileSync(partialPath, "utf8")) as RunResults & { progress?: ResumeProgress })
    : { runId, measuredAt: new Date().toISOString(), chains: {}, progress: {} };
  const progress: ResumeProgress = (run.progress ??= {});

  for (const key of keys) {
    const adapter = getAdapter(key, account);
    await checkBalance(adapter, key);

    const perChain: PerChainResults =
      run.chains[key] ?? { issueBatch: [], revokeFromBatch: [], readLatency: [] };
    run.chains[key] = perChain;

    let nextId = await nextBatchId(adapter);

    // issueBatch sweep — main, per-size skip
    for (const size of BATCH_SIZES) {
      if (!resumeNeedsOp(progress, key, "issueBatch", size)) {
        console.log(`[measure] ${key} issueBatch(${size}) already complete — skipping.`);
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

    // revoke burst + read latency are bundled (they share the seed batch)
    if (resumeNeedsOp(progress, key, "revokeBurst")) {
      console.log(`[measure] ${key} revoke burst (seed batchId=${nextId})`);
      const burst = await runRevokeBurst(adapter, nextId);
      perChain.issueBatch.push(burst.seed);
      perChain.revokeFromBatch.push(...burst.revokes);
      const seedBatchId = nextId;
      nextId += 1n;

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

      markComplete(progress, key, "revokeBurst");
      markComplete(progress, key, "readLatency");
      atomicWriteJson(partialPath, run);
    } else {
      console.log(`[measure] ${key} revoke burst already complete — skipping.`);
    }
  }

  // promote partial → final (strip transient progress field)
  process.removeListener("SIGINT", onInterrupt);
  process.removeListener("SIGTERM", onInterrupt);
  delete (run as { progress?: ResumeProgress }).progress;
  atomicWriteJson(finalPath, run);
  fs.unlinkSync(partialPath);
  console.log(`[measure] wrote ${finalPath}`);
  return finalPath;
}
