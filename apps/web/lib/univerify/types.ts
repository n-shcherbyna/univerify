import type { Address, Hex } from "viem";

export type ChainState = "unknown" | "ok" | "wrong";
export type TxState = "idle" | "signing" | "submitting" | "confirming";

export type OnChainRecord = {
  issuer: Address;
  revoked: boolean;
};

export type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

export type DiplomaTypes = {
  Diploma: readonly [{ name: "docHash"; type: "bytes32" }];
};

export type DiplomaEnvelopeEip712 = {
  payload: unknown;
  proof: {
    type: "EIP712";
    domain: Eip712Domain;
    types: DiplomaTypes;
    primaryType: "Diploma";
    signature: Hex;

    // optional info only
    issuer?: Address;
    merkle?: {
      batchId: number;
      proof: Hex[];
    };
  };
};

export type DiplomaEnvelopeMerkleBatch = {
  payload: unknown;
  proof: {
    type: "MERKLE_BATCH";
    batchId: number;
    proof: Hex[];
    issuer: Address;
    eip712?: {
      domain: Eip712Domain;
      types: DiplomaTypes;
      primaryType: "Diploma";
      signature: Hex;
    };
  };
};

export type DiplomaEnvelope = DiplomaEnvelopeEip712 | DiplomaEnvelopeMerkleBatch;
