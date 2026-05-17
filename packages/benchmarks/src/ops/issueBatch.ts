import { encodeFunctionData, keccak256, toBytes, type Address, type Hex } from "viem";
import {
  DiplomaRegistryAbi,
  buildMerkleFromLeaves,
  computeMerkleLeaf,
} from "@univerify/verifier-core";
import type { ChainAdapter, NormalizedMetrics } from "../chains/types.js";
import { now } from "../util/timing.js";
import { sendWithRetry } from "../util/nonceManager.js";

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

  return adapter.parseReceipt(
    { txHash: txHash!, calldata, submittedAt },
    "issueBatch",
    { batchSize, tag: opts.tag ?? "main" }
  );
}

async function bumpedGasPrice(adapter: ChainAdapter, attempt: number): Promise<bigint> {
  const base = await adapter.publicClient.getGasPrice();
  // bumpFactor^(attempt-1) — 1.25x at attempt 2, 1.5625x at attempt 3
  const mult = Math.pow(1.25, attempt - 1);
  return (base * BigInt(Math.floor(mult * 100))) / 100n;
}
