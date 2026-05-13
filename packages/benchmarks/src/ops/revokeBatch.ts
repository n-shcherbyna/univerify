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
