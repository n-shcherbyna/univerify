import { recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { DiplomaTypes, Eip712Domain } from "./types";
import { types } from "util";

export const DIPLOMA_TYPES: DiplomaTypes = {
  Diploma: [{ name: "docHash", type: "bytes32" }],
} as const;

export function buildUniVerifyDomain(params: {
  chainId: number;
  registry: Address;
  name?: string;
  version?: string;
}): Eip712Domain {
  return {
    name: params.name ?? "UniVerify",
    version: params.version ?? "1",
    chainId: params.chainId,
    verifyingContract: params.registry,
  };
}

export async function recoverIssuerFromEip712(params: {
  docHash: Hex;
  signature: Hex;
  domain: Eip712Domain;
  types?: DiplomaTypes;
}): Promise<Address> {
  return recoverTypedDataAddress({
    domain: params.domain,
    types: params.types ?? DIPLOMA_TYPES,
    primaryType: "Diploma",
    message: { docHash: params.docHash },
    signature: params.signature,
  });
}
