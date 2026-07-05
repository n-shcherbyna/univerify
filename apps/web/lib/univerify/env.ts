import { isAddress, type Address } from "viem";

export function requireDefined(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

export function requireAddress(value: string | undefined, name: string): Address {
  const v = requireDefined(value, name);
  if (!isAddress(v)) throw new Error(`Invalid address in env var ${name}: ${v}`);
  return v as Address;
}

/**
 * Read an optional address env var. Returns null when unset/empty so callers can
 * degrade gracefully (e.g. governance UI hidden). Throws only when set-but-invalid.
 */
export function optionalAddress(value: string | undefined, name: string): Address | null {
  const v = value?.trim();
  if (!v) return null;
  if (!isAddress(v)) throw new Error(`Invalid address in env var ${name}: ${v}`);
  return v as Address;
}

export function readPublicEnv() {
  const rpcUrl = requireDefined(process.env.NEXT_PUBLIC_RPC_URL, "NEXT_PUBLIC_RPC_URL");
  const registry = requireAddress(
    process.env.NEXT_PUBLIC_REGISTRY_ADDRESS,
    "NEXT_PUBLIC_REGISTRY_ADDRESS"
  );
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
  const deployBlock = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0");
  const multisig = optionalAddress(
    process.env.NEXT_PUBLIC_MULTISIG_ADDRESS,
    "NEXT_PUBLIC_MULTISIG_ADDRESS"
  );
  const timelock = optionalAddress(
    process.env.NEXT_PUBLIC_TIMELOCK_ADDRESS,
    "NEXT_PUBLIC_TIMELOCK_ADDRESS"
  );

  return { rpcUrl, registry, chainId, deployBlock, multisig, timelock };
}
