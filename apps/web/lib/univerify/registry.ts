// registry.ts
import {
  createPublicClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { sepolia } from "viem/chains";
import { DiplomaRegistryAbi, type StatusCode } from "@univerify/verifier-core";

export type RegistryPublicClient = PublicClient;

export function makePublicClient(rpcUrl: string): RegistryPublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

export function statusLabel(code: StatusCode): "Unknown" | "Valid" | "Revoked" {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

export async function readStatus(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  docHash: Hex;
}): Promise<StatusCode> {
  const code = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "status",
    args: [params.docHash],
  });

  return code as StatusCode;
}

export async function readRecord(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  docHash: Hex;
}): Promise<{ issuer: Address; revoked: boolean }> {
  const res = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "get",
    args: [params.docHash],
  });

  const [issuer, revoked] = res as readonly [Address, boolean];
  return { issuer, revoked };
}

export async function readIsIssuer(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  issuer: Address;
}): Promise<boolean> {
  const res = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "isIssuer",
    args: [params.issuer],
  });

  return res as boolean;
}
