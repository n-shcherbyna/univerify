import { createPublicClient, http, type Address, type Hex } from "viem";
import { sepolia } from "viem/chains";
import { DiplomaRegistryAbi, type StatusCode } from "@univerify/verifier-core";

export function makePublicClient(rpcUrl: string) {
  return createPublicClient({ chain: sepolia, transport: http(rpcUrl) });
}

export function statusLabel(code: StatusCode) {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

export async function readStatus(params: {
  publicClient: ReturnType<typeof makePublicClient>;
  registry: Address;
  docHash: Hex;
}): Promise<StatusCode> {
  return (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "status",
    args: [params.docHash],
  })) as StatusCode;
}

export async function readRecord(params: {
  publicClient: ReturnType<typeof makePublicClient>;
  registry: Address;
  docHash: Hex;
}): Promise<{ issuer: Address; issuedAtIso: string; revoked: boolean }> {
  const [issuer, issuedAt, revoked] = (await params.publicClient.readContract({
    address: params.registry,
    abi: DiplomaRegistryAbi,
    functionName: "get",
    args: [params.docHash],
  })) as readonly [Address, bigint, boolean];

  const issuedAtIso =
    issuer === "0x0000000000000000000000000000000000000000"
      ? "-"
      : new Date(Number(issuedAt) * 1000).toISOString();

  return { issuer, issuedAtIso, revoked };
}
