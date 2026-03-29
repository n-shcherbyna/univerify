// registryWrite.ts
import type { Address, Hex } from "viem";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { decodeRegistryRevert } from "./registryErrors";

export async function writeIssueBatchRootTx(params: {
  batchId: bigint;
  merkleRoot: Hex;
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  walletClient: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem WalletClient.writeContract has complex generics
    writeContract: (args: any) => Promise<Hex>;
  };
  setTxState: (s: TxState) => void;
  onTxHash?: (h: Hex) => void;
  onAfter?: () => Promise<void>;
}): Promise<void> {
  params.setTxState("submitting");

  try {
    const gas = await params.publicClient.estimateContractGas({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: "issueBatchRoot",
      args: [params.batchId, params.merkleRoot],
      account: params.account,
    });

    const tx = await params.walletClient.writeContract({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: "issueBatchRoot",
      args: [params.batchId, params.merkleRoot],
      gas: (gas * 120n) / 100n,
    });

    params.onTxHash?.(tx);
    params.setTxState("confirming");
    await params.publicClient.waitForTransactionReceipt({ hash: tx });

    if (params.onAfter) await params.onAfter();
    params.setTxState("idle");
  } catch (e) {
    const msg = decodeRegistryRevert(e, DiplomaRegistryAbi);
    params.setTxState("idle");
    throw new Error(msg ?? (e instanceof Error ? e.message : undefined) ?? "Transaction failed.");
  }
}

export async function writeRevokeFromBatchTx(params: {
  docHash: Hex;
  batchId: bigint;
  proof: readonly Hex[];
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  walletClient: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem WalletClient.writeContract has complex generics
    writeContract: (args: any) => Promise<Hex>;
  };
  setTxState: (s: TxState) => void;
  onTxHash?: (h: Hex) => void;
  onAfter?: () => Promise<void>;
}): Promise<void> {
  params.setTxState("submitting");

  try {
    const gas = await params.publicClient.estimateContractGas({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: "revokeFromBatch",
      args: [params.docHash, params.batchId, params.proof],
      account: params.account,
    });

    const tx = await params.walletClient.writeContract({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: "revokeFromBatch",
      args: [params.docHash, params.batchId, params.proof],
      gas: (gas * 120n) / 100n,
    });

    params.onTxHash?.(tx);
    params.setTxState("confirming");
    await params.publicClient.waitForTransactionReceipt({ hash: tx });

    if (params.onAfter) await params.onAfter();
    params.setTxState("idle");
  } catch (e) {
    const msg = decodeRegistryRevert(e, DiplomaRegistryAbi);
    params.setTxState("idle");
    throw new Error(msg ?? (e instanceof Error ? e.message : undefined) ?? "Transaction failed.");
  }
}
