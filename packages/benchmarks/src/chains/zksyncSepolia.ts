// packages/benchmarks/src/chains/zksyncSepolia.ts
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  hexToBytes,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
} from "viem";
import type {
  ChainAdapter,
  NormalizedMetrics,
  OpKind,
  TxSubmission,
} from "./types.js";
import { now } from "../util/timing.js";
import { RECEIPT_TIMEOUT_MS } from "../config.js";

const zksyncSepolia = defineChain({
  id: 300,
  name: "zkSync Sepolia Testnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://sepolia.era.zksync.dev"] } },
  testnet: true,
});

export type ZkSyncSepoliaAdapterInit = {
  rpcUrl: string;
  registryAddress: Address;
  account: Parameters<typeof createWalletClient>[0]["account"];
};

export function createZkSyncSepoliaAdapter(
  init: ZkSyncSepoliaAdapterInit
): ChainAdapter {
  const publicClient = createPublicClient({
    chain: zksyncSepolia,
    transport: http(init.rpcUrl),
  }) as PublicClient;

  const walletClient = createWalletClient({
    chain: zksyncSepolia,
    transport: http(init.rpcUrl),
    account: init.account,
  }) as WalletClient;

  return {
    chainId: 300,
    name: "zksyncSepolia",
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
        chainId: 300,
        chainName: "zksyncSepolia",
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
