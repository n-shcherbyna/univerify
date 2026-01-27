// registryWrite.ts
import type { Address, Hex } from "viem";
import {
  BaseError,
  ContractFunctionRevertedError,
  type Abi,
} from "viem";
import { DiplomaRegistryAbi, type StatusCode } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { decodeRegistryRevert } from "./registryErrors";

/**
 * Writes `issue(docHash)` or `revoke(docHash)` on DiplomaRegistry.
 * Does NOT store signatures on-chain. On-chain you store only docHash->(issuer, revoked).
 * Signature stays off-chain in the envelope JSON.
 */
export async function writeRegistryTx(params: {
  fn: "issue" | "revoke";
  docHash: Hex;
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  walletClient: {
    writeContract: (args: any) => Promise<Hex>;
  };
  setTxState: (s: TxState) => void;
  onTxHash?: (h: Hex) => void;
  onAfter?: () => Promise<void>;
}): Promise<void> {
  params.setTxState("submitting");

  // pre-check status (fast UX guard; contract still enforces rules)
  const code = (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "status",
    args: [params.docHash],
  })) as StatusCode;

  if (params.fn === "issue") {
    if (code !== 0) {
      throw new Error(
        code === 1
          ? "Already issued (Valid)."
          : "Already issued and revoked. Re-issuing the same docHash is not allowed."
      );
    }
  } else {
    if (code === 0) throw new Error("Cannot revoke: diploma not issued (Unknown).");
    if (code === 2) throw new Error("Already revoked.");
  }

  try {
    // gas
    const gas = await params.publicClient.estimateContractGas({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: params.fn,
      args: [params.docHash],
      account: params.account,
    });

    // send
    const tx = await params.walletClient.writeContract({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: params.fn,
      args: [params.docHash],
      gas: (gas * 120n) / 100n,
    });

    params.onTxHash?.(tx);

    // confirm
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
