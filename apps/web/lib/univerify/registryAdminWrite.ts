// registryAdminWrite.ts
import type { Address, Hex } from "viem";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { decodeRegistryRevert } from "./registryErrors";

export async function writeIssuerAdminTx(params: {
  fn: "removeIssuer" | "setUniversity" | "onboardIssuerAndUniversity";
  issuer: Address;
  universityId?: bigint;
  universityStatus?: number;
  universityMetadataHash?: Hex;
  snapshotHash?: Hex;
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  walletClient: { writeContract: (args: any) => Promise<Hex> };
  setTxState: (s: TxState) => void;
  onTxHash?: (h: Hex) => void;
  onAfter?: () => Promise<void>;
}) {
  params.setTxState("submitting");
  try {
    let gas: bigint;
    if (params.fn === "removeIssuer") {
      gas = await params.publicClient.estimateContractGas({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "removeIssuer",
        args: [params.issuer],
        account: params.account,
      });
    } else if (params.fn === "setUniversity") {
      gas = await params.publicClient.estimateContractGas({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "setUniversity",
        args: [
          params.universityId ?? 0n,
          params.universityMetadataHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
          params.universityStatus ?? 0,
        ],
        account: params.account,
      });
    } else {
      gas = await params.publicClient.estimateContractGas({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "onboardIssuerAndUniversity",
        args: [
          params.issuer,
          params.universityId ?? 0n,
          params.universityMetadataHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
          params.snapshotHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
        ],
        account: params.account,
      });
    }

    let tx: Hex;
    if (params.fn === "removeIssuer") {
      tx = await params.walletClient.writeContract({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "removeIssuer",
        args: [params.issuer],
        gas: (gas * 120n) / 100n,
      });
    } else if (params.fn === "setUniversity") {
      tx = await params.walletClient.writeContract({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "setUniversity",
        args: [
          params.universityId ?? 0n,
          params.universityMetadataHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
          params.universityStatus ?? 0,
        ],
        gas: (gas * 120n) / 100n,
      });
    } else {
      tx = await params.walletClient.writeContract({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "onboardIssuerAndUniversity",
        args: [
          params.issuer,
          params.universityId ?? 0n,
          params.universityMetadataHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
          params.snapshotHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000",
        ],
        gas: (gas * 120n) / 100n,
      });
    }

    params.onTxHash?.(tx);

    params.setTxState("confirming");
    await params.publicClient.waitForTransactionReceipt({ hash: tx });

    if (params.onAfter) await params.onAfter();
    params.setTxState("idle");
  } catch (e) {
    const msg = decodeRegistryRevert(e, DiplomaRegistryAbi);
    params.setTxState("idle");
    throw new Error(msg ?? (e as any)?.shortMessage ?? (e as any)?.message ?? "Transaction failed.");
  }
}
