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

export type UniversityMeta = {
  name: string;
  country: string;
  website: string;
  accreditationId: string;
  status: number;
};

export function makePublicClient(rpcUrl: string): RegistryPublicClient {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

export function statusLabel(code: StatusCode): "Unknown" | "Valid" | "Revoked" {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

export function universityStatusLabel(status: number): string {
  if (status === 1) return "Active";
  if (status === 2) return "Suspended";
  if (status === 3) return "Revoked";
  return "Unknown";
}

export async function readStatusWithProofTrusted(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  docHash: Hex;
  issuer: Address;
  batchId: bigint;
  proof: readonly Hex[];
}): Promise<StatusCode> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "statusWithProofTrusted",
    args: [params.docHash, params.issuer, params.batchId, params.proof],
  })) as StatusCode;
}

export async function readStatusWithProof(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  docHash: Hex;
  issuer: Address;
  batchId: bigint;
  proof: readonly Hex[];
}): Promise<StatusCode> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "statusWithProof",
    args: [params.docHash, params.issuer, params.batchId, params.proof],
  })) as StatusCode;
}

export async function readBatch(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  issuer: Address;
  batchId: bigint;
}): Promise<{ issuer: Address; merkleRoot: Hex }> {
  const merkleRoot = (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "getBatch",
    args: [params.issuer, params.batchId],
  })) as Hex;
  return { issuer: params.issuer, merkleRoot };
}

export async function readIsRevoked(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  docHash: Hex;
  issuer: Address;
  batchId: bigint;
}): Promise<boolean> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "isRevoked",
    args: [params.docHash, params.issuer, params.batchId],
  })) as boolean;
}

export async function readIsIssuer(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  issuer: Address;
}): Promise<boolean> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "isIssuer",
    args: [params.issuer],
  })) as boolean;
}

export async function readIssuerUniversityId(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  issuer: Address;
}): Promise<bigint> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "issuerUniversityId",
    args: [params.issuer],
  })) as bigint;
}

export async function readOwner(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
}): Promise<Address> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "owner",
    args: [],
  })) as Address;
}

export async function readUniversityStatus(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  universityId: bigint;
}): Promise<number> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "getUniversityStatus",
    args: [params.universityId],
  })) as number;
}

export async function readUniversityMeta(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  universityId: bigint;
  fromBlock?: bigint;
}): Promise<UniversityMeta | null> {
  const logs = await params.publicClient.getLogs({
    address: params.registry,
    event: {
      type: "event",
      name: "UniversitySet",
      inputs: [
        { name: "universityId", type: "uint64", indexed: true },
        { name: "status", type: "uint8", indexed: true },
        { name: "name", type: "string", indexed: false },
        { name: "country", type: "string", indexed: false },
        { name: "website", type: "string", indexed: false },
        { name: "accreditationId", type: "string", indexed: false },
      ],
    },
    args: { universityId: params.universityId },
    fromBlock: params.fromBlock ?? 0n,
    toBlock: "latest",
  });

  if (logs.length === 0) return null;
  const latest = logs[logs.length - 1].args as any;
  return {
    name: latest.name ?? "",
    country: latest.country ?? "",
    website: latest.website ?? "",
    accreditationId: latest.accreditationId ?? "",
    status: Number(latest.status ?? 0),
  };
}
