import { NextResponse, type NextRequest } from "next/server";
import { isAddress, type Address, type Hex } from "viem";
import {
  computeMerkleLeaf,
  computeRootFromProof,
  type StatusCode,
} from "@univerify/verifier-core";
import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readBatch,
  readIsRevoked,
  readStatusWithProof,
  statusLabel,
} from "@/lib/univerify/registry";
import { apiGuard } from "@/lib/api/guard";

export const dynamic = "force-dynamic";

const BYTES32_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * GET /api/status?docHash=0x...&issuer=0x...&batchId=1&proof=0x...,0x...
 *
 * Lightweight status check for a single diploma by its document hash.
 * All parameters are required because on-chain verification needs the Merkle proof.
 *
 * Response: { status, docHash, revoked, merkle }
 */
export async function GET(request: NextRequest) {
  const guardResponse = apiGuard(request);
  if (guardResponse) return guardResponse;
  const params = request.nextUrl.searchParams;

  const docHash = params.get("docHash");
  if (!docHash || !BYTES32_RE.test(docHash)) {
    return NextResponse.json(
      { error: "Missing or invalid docHash (expected bytes32 hex)" },
      { status: 400 }
    );
  }

  const issuer = params.get("issuer");
  if (!issuer || !isAddress(issuer)) {
    return NextResponse.json(
      { error: "Missing or invalid issuer (expected Ethereum address)" },
      { status: 400 }
    );
  }

  const batchIdRaw = params.get("batchId");
  if (!batchIdRaw || !/^\d+$/.test(batchIdRaw)) {
    return NextResponse.json(
      { error: "Missing or invalid batchId (expected non-negative integer)" },
      { status: 400 }
    );
  }
  const batchId = BigInt(batchIdRaw);

  const proofRaw = params.get("proof") ?? "";
  const proofNodes = proofRaw
    ? proofRaw.split(",").map((s) => s.trim())
    : [];

  if (proofNodes.length > 64) {
    return NextResponse.json(
      { error: "proof is unreasonably large (max 64 nodes)" },
      { status: 400 }
    );
  }
  for (const node of proofNodes) {
    if (!BYTES32_RE.test(node)) {
      return NextResponse.json(
        { error: `Invalid proof node: ${node} (expected bytes32 hex)` },
        { status: 400 }
      );
    }
  }
  const proof = proofNodes as Hex[];

  const { rpcUrl, registry, chainId } = readPublicEnv();
  const publicClient = makePublicClient(rpcUrl, chainId);

  try {
    const [statusCode, batch, revoked] = await Promise.all([
      readStatusWithProof({
        publicClient,
        registry,
        docHash: docHash as Hex,
        issuer: issuer as Address,
        batchId,
        proof,
      }),
      readBatch({
        publicClient,
        registry,
        issuer: issuer as Address,
        batchId,
      }),
      readIsRevoked({
        publicClient,
        registry,
        docHash: docHash as Hex,
        issuer: issuer as Address,
        batchId,
      }),
    ]) as [StatusCode, { issuer: Address; merkleRoot: Hex }, boolean];

    const leaf = computeMerkleLeaf({
      registry,
      chainId: BigInt(chainId),
      issuer: issuer as Address,
      batchId,
      docHash: docHash as Hex,
    });
    const computedRoot = computeRootFromProof({ leaf, proof });
    const merkleRootMatches =
      computedRoot.toLowerCase() === batch.merkleRoot.toLowerCase();

    return NextResponse.json({
      status: {
        code: statusCode,
        label: statusLabel(statusCode),
      },
      docHash,
      issuer,
      batchId: Number(batchId),
      revoked,
      merkle: {
        leaf,
        computedRoot,
        onChainRoot: batch.merkleRoot,
        rootMatches: merkleRootMatches,
      },
      chain: {
        id: chainId,
        registry,
      },
    });
  } catch (e: any) {
    return NextResponse.json(
      { error: `Status lookup failed: ${e.message}` },
      { status: 502 }
    );
  }
}
