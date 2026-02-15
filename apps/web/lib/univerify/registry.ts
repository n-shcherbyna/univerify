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

export async function readStatusWithProof(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  docHash: Hex;
  issuer: Address;
  batchId: bigint;
  proof: readonly Hex[];
}): Promise<StatusCode> {
  const code = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "statusWithProof",
    args: [params.docHash, params.issuer, params.batchId, params.proof],
  });

  return code as StatusCode;
}

export async function readBatch(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  issuer: Address;
  batchId: bigint;
}): Promise<{ issuer: Address; merkleRoot: Hex }> {
  const res = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "getBatch",
    args: [params.issuer, params.batchId],
  });

  const merkleRoot = res as Hex;
  return { issuer: params.issuer, merkleRoot };
}

export async function readIsRevoked(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  docHash: Hex;
  issuer: Address;
  batchId: bigint;
}): Promise<boolean | null> {
  try {
    const res = await params.publicClient.readContract({
      address: params.registry,
      abi: DiplomaRegistryAbi,
      functionName: "isRevoked",
      args: [params.docHash, params.issuer, params.batchId],
    });
    return res as boolean;
  } catch {
    // Backward compatibility: old deployments do not implement isRevoked().
    return null;
  }
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

export async function readIssuerUniversityId(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  issuer: Address;
}): Promise<bigint> {
  const res = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "issuerUniversityId",
    args: [params.issuer],
  });
  return res as bigint;
}

export async function readOwner(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
}): Promise<Address> {
  const res = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "owner",
    args: [],
  });
  return res as Address;
}

export async function readUniversity(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  universityId: bigint;
}): Promise<{ metadataHash: Hex; status: number }> {
  const res = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "getUniversity",
    args: [params.universityId],
  });
  const [metadataHash, status] = res as readonly [Hex, number];
  return { metadataHash, status };
}

export async function readSnapshot(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
}): Promise<{ hash: Hex }> {
  const hash = await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "snapshotHash",
    args: [],
  });
  return { hash: hash as Hex };
}
