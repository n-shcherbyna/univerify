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

export function readPublicEnv() {
  // During static page generation (next build) env vars may not be set.
  // Client pages guard actions behind wallet connection, so empty defaults are safe.
  const rpcUrl = process.env.NEXT_PUBLIC_RPC_URL ?? "";
  const rawRegistry = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS ?? "";
  const registry = (isAddress(rawRegistry) ? rawRegistry : "0x0000000000000000000000000000000000000000") as Address;
  const chainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? "11155111");
  const deployBlock = BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK ?? "0");

  return { rpcUrl, registry, chainId, deployBlock };
}
