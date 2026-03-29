import type { Address, Hex } from "viem";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { decodeRegistryRevert } from "./registryErrors";

type AdminTxCommon = {
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem WalletClient.writeContract has complex generics
  walletClient: { writeContract: (args: any) => Promise<Hex> };
  setTxState: (s: TxState) => void;
  onTxHash?: (h: Hex) => void;
  onAfter?: () => Promise<void>;
};

type UniversityFields = {
  universityId: bigint;
  name: string;
  country: string;
  website: string;
  accreditationId: string;
};

type RemoveIssuerTx = AdminTxCommon & { fn: "removeIssuer"; issuer: Address };
type SetUniversityTx = AdminTxCommon & { fn: "setUniversity"; status: number } & UniversityFields;
type OnboardTx = AdminTxCommon & { fn: "onboardIssuerAndUniversity"; issuer: Address } & UniversityFields;
type TransferOwnershipTx = AdminTxCommon & { fn: "transferOwnership"; newOwner: Address };
type AcceptOwnershipTx = AdminTxCommon & { fn: "acceptOwnership" };

type AdminTxParams = RemoveIssuerTx | SetUniversityTx | OnboardTx | TransferOwnershipTx | AcceptOwnershipTx;

export async function writeIssuerAdminTx(params: AdminTxParams) {
  params.setTxState("submitting");
  try {
    type FnName = "removeIssuer" | "setUniversity" | "onboardIssuerAndUniversity" | "transferOwnership" | "acceptOwnership";
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic args for multiple contract functions
    let args: any[];
    let functionName: FnName;

    if (params.fn === "removeIssuer") {
      functionName = "removeIssuer";
      args = [params.issuer];
    } else if (params.fn === "setUniversity") {
      functionName = "setUniversity";
      args = [params.universityId, params.status, params.name, params.country, params.website, params.accreditationId];
    } else if (params.fn === "transferOwnership") {
      functionName = "transferOwnership";
      args = [params.newOwner];
    } else if (params.fn === "acceptOwnership") {
      functionName = "acceptOwnership";
      args = [];
    } else {
      functionName = "onboardIssuerAndUniversity";
      args = [params.issuer, params.universityId, params.name, params.country, params.website, params.accreditationId];
    }

    const gas = await params.publicClient.estimateContractGas({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic args tuple
      args: args as any,
      account: params.account,
    });

    const tx = await params.walletClient.writeContract({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic args tuple
      args: args as any,
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
