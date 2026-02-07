// registryAdminWrite.ts
import type { Address, Hex } from "viem";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { decodeRegistryRevert } from "./registryErrors";

export async function writeIssuerAdminTx(params: {
  fn: "addIssuer" | "removeIssuer";
  issuer: Address;
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
    const gas = await params.publicClient.estimateContractGas({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: params.fn,
      args: [params.issuer],
      account: params.account,
    });

    const tx = await params.walletClient.writeContract({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: params.fn,
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
