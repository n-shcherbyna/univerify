import { canonicalize } from "json-canonicalize";
import { keccak256, toBytes } from "viem";

export function hashPayload(payload: unknown): `0x${string}` {
  return keccak256(toBytes(canonicalize(payload)));
}
