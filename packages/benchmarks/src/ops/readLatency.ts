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
