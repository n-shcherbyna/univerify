import { encodeFunctionData, type Address, type Hex } from "viem";
import { DiplomaRegistryAbi, buildMerkleFromLeaves } from "@univerify/verifier-core";
import type { ChainAdapter, NormalizedMetrics } from "../chains/types.js";
import { BENCH_RANDOM_SEED, REVOKE_N, SEED_BATCH_SIZE } from "../config.js";
import { createPrng, sampleWithoutReplacement } from "../util/prng.js";
import { now } from "../util/timing.js";
import { sendWithRetry } from "../util/nonceManager.js";
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

  // 3. REVOKE_N distinct revokes — uniformly sampled from [0, SEED_BATCH_SIZE).
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
    const receipt = await sendWithRetry({
      client: adapter.publicClient,
      send: async () =>
        adapter.walletClient.sendTransaction({
          to: adapter.registryAddress,
          data: calldata,
          account: adapter.walletClient.account!,
          chain: adapter.walletClient.chain!,
        }),
      timeoutMs: 600_000,
      maxAttempts: 1,
      bumpFactor: 1,
    });
    const txHash = receipt.transactionHash as Hex;

    const metrics = await adapter.parseReceipt(
      { txHash, calldata, submittedAt },
      "revokeFromBatch"
    );
    revokes.push(metrics);
  }
  return { seed, revokes };
}
