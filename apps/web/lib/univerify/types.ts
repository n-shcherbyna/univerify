import type { Address, Hex } from "viem";

export type ChainState = "unknown" | "ok" | "wrong";
export type TxState = "idle" | "submitting" | "confirming";

export type DiplomaEnvelope = {
  payload: unknown;
  proof: {
    type: "MERKLE_BATCH";
    batchId: number;
    proof: Hex[];
    issuer: Address;
  };
};
