// registryAdminWrite.ts
import type { Address, Hex } from "viem";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { decodeRegistryRevert } from "./registryErrors";

export async function writeIssuerAdminTx(params: {
  fn: "addIssuer" | "removeIssuer";
  issuer: Address;
  universityId?: bigint;
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
    const gas = params.fn === "addIssuer"
      ? await params.publicClient.estimateContractGas({
          address: params.registry,
          abi: DiplomaRegistryAbi,
          functionName: "addIssuer",
          args: [params.issuer, params.universityId ?? 0n],
          account: params.account,
        })
      : await params.publicClient.estimateContractGas({
          address: params.registry,
          abi: DiplomaRegistryAbi,
          functionName: "removeIssuer",
          args: [params.issuer],
          account: params.account,
        });

    const tx = params.fn === "addIssuer"
      ? await params.walletClient.writeContract({
          address: params.registry,
          abi: DiplomaRegistryAbi,
          functionName: "addIssuer",
          args: [params.issuer, params.universityId ?? 0n],
          gas: (gas * 120n) / 100n,
        })
      : await params.walletClient.writeContract({
          address: params.registry,
          abi: DiplomaRegistryAbi,
          functionName: "removeIssuer",
          args: [params.issuer],
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
    throw new Error(msg ?? (e as any)?.shortMessage ?? (e as any)?.message ?? "Transaction failed.");
  }
}
