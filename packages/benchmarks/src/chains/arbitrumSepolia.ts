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
      const gasUsedForL1 =
        receipt.gasUsedForL1 != null
          ? BigInt(receipt.gasUsedForL1 as unknown as string | number | bigint)
          : 0n;
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
