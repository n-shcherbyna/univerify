// registryAdminWrite.ts
import type { Address, Hex } from "viem";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { decodeRegistryRevert } from "./registryErrors";

type AdminTxCommon = {
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  walletClient: { writeContract: (args: any) => Promise<Hex> };
  setTxState: (s: TxState) => void;
  onTxHash?: (h: Hex) => void;
  onAfter?: () => Promise<void>;
};

type RemoveIssuerTx = AdminTxCommon & {
  fn: "removeIssuer";
  issuer: Address;
};

type SetUniversityTx = AdminTxCommon & {
  fn: "setUniversity";
  universityId: bigint;
  universityStatus: number;
  universityMetadataHash: Hex;
};

type SetUniversityAndSnapshotTx = AdminTxCommon & {
  fn: "setUniversityAndSnapshot";
  universityId: bigint;
  universityStatus: number;
  universityMetadataHash: Hex;
  snapshotHash: Hex;
};

type OnboardIssuerAndUniversityTx = AdminTxCommon & {
  fn: "onboardIssuerAndUniversity";
  issuer: Address;
  universityId: bigint;
  universityMetadataHash: Hex;
  snapshotHash: Hex;
};

type AdminTxParams = RemoveIssuerTx | SetUniversityTx | SetUniversityAndSnapshotTx | OnboardIssuerAndUniversityTx;

export async function writeIssuerAdminTx(params: AdminTxParams) {
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
        args: [params.universityId, params.universityMetadataHash, params.universityStatus],
        account: params.account,
      });
    } else if (params.fn === "setUniversityAndSnapshot") {
      gas = await params.publicClient.estimateContractGas({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "setUniversityAndSnapshot",
        args: [params.universityId, params.universityMetadataHash, params.universityStatus, params.snapshotHash],
        account: params.account,
      });
    } else {
      gas = await params.publicClient.estimateContractGas({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "onboardIssuerAndUniversity",
        args: [params.issuer, params.universityId, params.universityMetadataHash, params.snapshotHash],
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
        args: [params.universityId, params.universityMetadataHash, params.universityStatus],
        gas: (gas * 120n) / 100n,
      });
    } else if (params.fn === "setUniversityAndSnapshot") {
      tx = await params.walletClient.writeContract({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "setUniversityAndSnapshot",
        args: [params.universityId, params.universityMetadataHash, params.universityStatus, params.snapshotHash],
        gas: (gas * 120n) / 100n,
      });
    } else {
      tx = await params.walletClient.writeContract({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "onboardIssuerAndUniversity",
        args: [params.issuer, params.universityId, params.universityMetadataHash, params.snapshotHash],
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
