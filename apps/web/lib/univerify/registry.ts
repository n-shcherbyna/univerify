import {
  createPublicClient,
  defineChain,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet, sepolia } from "viem/chains";
import { DiplomaRegistryAbi, type StatusCode } from "@univerify/verifier-core";

const KNOWN_CHAINS: Record<number, Chain> = { 1: mainnet, 11155111: sepolia };

function resolveChain(chainId: number): Chain {
  return KNOWN_CHAINS[chainId] ?? defineChain({
    id: chainId,
    name: `Chain ${chainId}`,
    nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [] } },
  });
}

export type RegistryPublicClient = PublicClient;

export type UniversityMeta = {
  name: string;
  country: string;
  website: string;
  accreditationId: string;
  status: number;
};

export function makePublicClient(rpcUrl: string, chainId: number): RegistryPublicClient {
  return createPublicClient({ chain: resolveChain(chainId), transport: http(rpcUrl) });
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

export type UniversityOverview = UniversityMeta & { universityId: bigint };

export type IssuerOverview = {
  issuer: Address;
  universityId: bigint;
  universityName: string | null;
  active: boolean;
};

export async function readRegistryOverview(params: {
  publicClient: RegistryPublicClient;
  registry: Address;
  fromBlock: bigint;
}): Promise<{ universities: UniversityOverview[]; issuers: IssuerOverview[] }> {
  const uniEventAbi = {
    type: "event" as const,
    name: "UniversitySet",
    inputs: [
      { name: "universityId", type: "uint64", indexed: true },
      { name: "status", type: "uint8", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "country", type: "string", indexed: false },
      { name: "website", type: "string", indexed: false },
      { name: "accreditationId", type: "string", indexed: false },
    ],
  };

  const [uniLogs, issuerAddedLogs] = await Promise.all([
    params.publicClient.getLogs({
      address: params.registry,
      event: uniEventAbi,
      fromBlock: params.fromBlock,
      toBlock: "latest",
    }),
    params.publicClient.getLogs({
      address: params.registry,
      event: { type: "event" as const, name: "IssuerAdded", inputs: [{ name: "issuer", type: "address", indexed: true }] },
      fromBlock: params.fromBlock,
      toBlock: "latest",
    }),
  ]);

  // Latest UniversitySet event per universityId
  const uniMap = new Map<string, UniversityOverview>();
  for (const l of uniLogs) {
    const a = l.args as any;
    const id: bigint = a.universityId;
    uniMap.set(id.toString(), {
      universityId: id,
      status: Number(a.status ?? 0),
      name: a.name ?? "",
      country: a.country ?? "",
      website: a.website ?? "",
      accreditationId: a.accreditationId ?? "",
    });
  }
  const universities = [...uniMap.values()].sort((a, b) =>
    a.universityId < b.universityId ? -1 : 1
  );

  // Unique issuer addresses ever added
  const uniqueIssuers = [
    ...new Set(issuerAddedLogs.map((l) => ((l.args as any).issuer as Address).toLowerCase())),
  ] as Address[];

  // Resolve current state for each
  const issuerData = await Promise.all(
    uniqueIssuers.map(async (issuer) => {
      const uid = await readIssuerUniversityId({ publicClient: params.publicClient, registry: params.registry, issuer });
      const uni = uid > 0n ? uniMap.get(uid.toString()) : undefined;
      return {
        issuer,
        universityId: uid,
        universityName: uni?.name ?? null,
        active: uid > 0n,
      } as IssuerOverview;
    })
  );
  const issuers = issuerData.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));

  return { universities, issuers };
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
