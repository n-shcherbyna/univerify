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
  universityName: Hex;
  universityStatus: number;
};

type OnboardIssuerAndUniversityTx = AdminTxCommon & {
  fn: "onboardIssuerAndUniversity";
  issuer: Address;
  universityId: bigint;
  universityName: Hex;
};

type AdminTxParams = RemoveIssuerTx | SetUniversityTx | OnboardIssuerAndUniversityTx;

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
        args: [params.universityId, params.universityName, params.universityStatus],
        account: params.account,
      });
    } else {
      gas = await params.publicClient.estimateContractGas({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "onboardIssuerAndUniversity",
        args: [params.issuer, params.universityId, params.universityName],
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
        args: [params.universityId, params.universityName, params.universityStatus],
        gas: (gas * 120n) / 100n,
      });
    } else {
      tx = await params.walletClient.writeContract({
        address: params.registry,
        abi: DiplomaRegistryAbi,
        functionName: "onboardIssuerAndUniversity",
        args: [params.issuer, params.universityId, params.universityName],
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
