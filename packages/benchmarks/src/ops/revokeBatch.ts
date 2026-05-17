import { encodeFunctionData, type Address, type Hex } from "viem";
import { DiplomaRegistryAbi, buildMerkleFromLeaves } from "@univerify/verifier-core";
import type { ChainAdapter, NormalizedMetrics } from "../chains/types.js";
import { REVOKE_N, SEED_BATCH_SIZE } from "../config.js";
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
    let txHash: Hex | undefined;
    await sendWithRetry({
      client: adapter.publicClient,
      send: async (attempt) => {
        const hash = await adapter.walletClient.sendTransaction({
          to: adapter.registryAddress,
          data: calldata,
          account: adapter.walletClient.account!,
          chain: adapter.walletClient.chain!,
          // For attempts > 1, bump gas to replace any dropped pending tx.
          ...(attempt > 1
            ? { gasPrice: await bumpedGasPrice(adapter, attempt) }
            : {}),
        });
        txHash = hash;
        return hash;
      },
      timeoutMs: 90_000, // per-attempt; parseReceipt below has its own RECEIPT_TIMEOUT_MS as a safety net
      maxAttempts: 3,
      bumpFactor: 1.25,
    });

    const metrics = await adapter.parseReceipt(
      { txHash: txHash!, calldata, submittedAt },
      "revokeFromBatch"
    );
    revokes.push(metrics);
  }
  return { seed, revokes };
}

async function bumpedGasPrice(adapter: ChainAdapter, attempt: number): Promise<bigint> {
  const base = await adapter.publicClient.getGasPrice();
  // bumpFactor^(attempt-1) — 1.25x at attempt 2, 1.5625x at attempt 3
  const mult = Math.pow(1.25, attempt - 1);
  return (base * BigInt(Math.floor(mult * 100))) / 100n;
}
