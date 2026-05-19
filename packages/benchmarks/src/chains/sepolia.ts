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
    transport: http(init.rpcUrl, { retryCount: 0 }),
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
