import type { Address, Hex } from "viem";
import type { DiplomaPayload } from "./schema";

export type ChainState = "unknown" | "ok" | "wrong";
export type TxState = "idle" | "submitting" | "confirming";

export type DiplomaEnvelope = {
  payload: DiplomaPayload;
  proof: {
    type: "MERKLE_BATCH";
    batchId: number;
    proof: Hex[];
    issuer: Address;
  };
};
