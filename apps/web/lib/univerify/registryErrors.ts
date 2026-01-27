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
    case "BadIssuer": return "Bad issuer address.";
    case "BadHash": return "Bad doc hash.";
    case "AlreadyIssued": return "Already issued.";
    case "NotIssuerOfRecord": return "You are not the issuer of this record.";
    case "AlreadyRevoked": return "Already revoked.";
    default: return `Transaction reverted: ${name}.`;
  }
}
