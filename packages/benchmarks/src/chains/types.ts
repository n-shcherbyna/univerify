// packages/benchmarks/src/chains/types.ts
import type { Address, Hex, PublicClient, WalletClient } from "viem";

export type OpKind = "issueBatch" | "revokeFromBatch" | "statusWithProof";

export type NormalizedMetrics = {
  chainId: number;
  chainName: string;
  op: OpKind;
  /** Only present for issueBatch. */
  batchSize?: number;
  /** Only present for issueBatch; tags the seed batch used to prime revokeBatch. */
  tag?: "seed" | "main";
  gasUsed: bigint;
  effectiveGasPrice: bigint;
  l1DataFee: bigint;
  l1GasUsed?: bigint;
  calldataBytes: number;
  blockNumber: bigint;
  txHash: Hex;
  submittedAt: number;
  includedAt: number;
  inclusionLatencyMs: number;
};

export type ReadLatencySample = {
  chainId: number;
  chainName: string;
  op: "statusWithProof";
  latencyMs: number;
  sampledAt: number;
};

export type TxSubmission = {
  txHash: Hex;
  calldata: Hex;
  submittedAt: number;
};

export interface ChainAdapter {
  chainId: number;
  name: string;
  /** viem public client used for reads and receipt polling. */
  publicClient: PublicClient;
  /** viem wallet client used for signed writes. */
  walletClient: WalletClient;
  /** Deployment address for DiplomaRegistry on this chain. */
  registryAddress: Address;
  /**
   * Parse a chain-specific receipt into NormalizedMetrics. Each adapter knows
   * where the L1 data fee lives on its chain (or that it is zero for L1).
   */
  parseReceipt(
    submission: TxSubmission,
    op: OpKind,
    extra?: { batchSize?: number; tag?: "seed" | "main" }
  ): Promise<NormalizedMetrics>;
}
