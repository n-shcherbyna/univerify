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
    transport: http(init.rpcUrl, { retryCount: 0 }),
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
        l1DataFee:
          receipt.l1Fee != null
            ? BigInt(receipt.l1Fee as unknown as string | number | bigint)
            : 0n,
        l1GasUsed:
          receipt.l1GasUsed != null
            ? BigInt(receipt.l1GasUsed as unknown as string | number | bigint)
            : undefined,
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
