// registryErrors.ts
import { BaseError, ContractFunctionRevertedError, type Abi } from "viem";

export function decodeRegistryRevert(err: unknown, abi: Abi): string | null {
  const base = err as BaseError;

  const reverted = base?.walk?.(
    (e) => e instanceof ContractFunctionRevertedError
  ) as ContractFunctionRevertedError | undefined;

  if (!reverted) {
    const msg = (base?.shortMessage ?? base?.message ?? "").toLowerCase();
    if (msg.includes("user rejected") || msg.includes("user denied") || msg.includes("rejected")) {
      return "Transaction rejected in wallet.";
    }
    return null;
  }

  const name = reverted.data?.errorName;
  if (!name) return reverted.shortMessage ?? "Transaction reverted.";

  switch (name) {
    case "OnlyOwner": return "Only owner can do this.";
    case "OnlyIssuer": return "Only approved issuer can do this.";
    case "NoChange": return "No state change: same data already set.";
    case "BadIssuer": return "Bad issuer address.";
    case "BadUniversityId": return "Bad university ID.";
    case "BadUniversityStatus": return "Bad university status.";
    case "BadSnapshot": return "Bad snapshot hash.";
    case "UniversityNotActive": return "University is not active.";
    case "BadHash": return "Bad doc hash.";
    case "BadRoot": return "Bad Merkle root.";
    case "BatchAlreadyIssued": return "Batch ID already used.";
    case "NotIssuerOfBatch": return "You are not the issuer of this batch.";
    case "AlreadyRevoked": return "Already revoked.";
    case "InvalidProof": return "Invalid Merkle proof.";
    case "OnlyPendingOwner": return "Only the pending owner can accept ownership.";
    case "NewOwnerIsZero": return "New owner cannot be the zero address.";
    default: return `Transaction reverted: ${name}.`;
  }
}
