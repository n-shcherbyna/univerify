import { NextResponse, type NextRequest } from "next/server";
import { type Address, type Hex } from "viem";
import {
  hashPayload,
  DiplomaPayloadSchema,
  computeMerkleLeaf,
  computeRootFromProof,
  type StatusCode,
} from "@univerify/verifier-core";
import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readBatch,
  readIsIssuer,
  readIsRevoked,
  readIssuerUniversityId,
  readStatusWithProof,
  readUniversityMeta,
  statusLabel,
  universityStatusLabel,
} from "@/lib/univerify/registry";
import { validateDiplomaEnvelope } from "@/lib/univerify/json";
import { apiGuard } from "@/lib/api/guard";

export const dynamic = "force-dynamic";

/**
 * POST /api/verify
 *
 * Accepts a diploma envelope JSON body. Returns the full verification result
 * including on-chain status, Merkle proof validation, and university metadata.
 *
 * Request body: { payload: DiplomaPayload, proof: { type: "MERKLE_BATCH", ... } }
 * Response:     { verified, status, docHash, issuer, batchId, university, merkle, ... }
 */
export async function POST(request: NextRequest) {
  const guardResponse = apiGuard(request);
  if (guardResponse) return guardResponse;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let envelope;
  try {
    envelope = validateDiplomaEnvelope(body);
  } catch (e: unknown) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }

  const { rpcUrl, registry, chainId, deployBlock } = readPublicEnv();
  const publicClient = makePublicClient(rpcUrl, chainId);

  const docHash = hashPayload(envelope.payload);
  const issuer = envelope.proof.issuer;
  const batchId = BigInt(envelope.proof.batchId);
  const proof = envelope.proof.proof;

  try {
    const [statusCode, batch, issuerTrusted, issuerUniversityId, revoked] =
      await Promise.all([
        readStatusWithProof({ publicClient, registry, docHash, issuer, batchId, proof }),
        readBatch({ publicClient, registry, issuer, batchId }),
        readIsIssuer({ publicClient, registry, issuer }),
        readIssuerUniversityId({ publicClient, registry, issuer }),
        readIsRevoked({ publicClient, registry, docHash, issuer, batchId }),
      ]) as [StatusCode, { issuer: Address; merkleRoot: Hex }, boolean, bigint, boolean];

    const leaf = computeMerkleLeaf({
      registry,
      chainId: BigInt(chainId),
      issuer,
      batchId,
      docHash,
    });
    const computedRoot = computeRootFromProof({ leaf, proof });
    const merkleRootMatches =
      computedRoot.toLowerCase() === batch.merkleRoot.toLowerCase();

    const university =
      issuerUniversityId > 0n
        ? await readUniversityMeta({
            publicClient,
            registry,
            universityId: issuerUniversityId,
            fromBlock: deployBlock,
          })
        : null;

    const universityActive = university?.status === 1;
    const verified = statusCode === 1 && merkleRootMatches && universityActive;

    const parsedPayload = DiplomaPayloadSchema.safeParse(envelope.payload);

    return NextResponse.json({
      verified,
      status: {
        code: statusCode,
        label: statusLabel(statusCode),
      },
      docHash,
      issuer: {
        address: issuer,
        trusted: issuerTrusted,
        universityId: issuerUniversityId.toString(),
      },
      batchId: envelope.proof.batchId,
      revoked,
      merkle: {
        leaf,
        computedRoot,
        onChainRoot: batch.merkleRoot,
        rootMatches: merkleRootMatches,
      },
      university: university
        ? {
            name: university.name,
            country: university.country,
            website: university.website,
            accreditationId: university.accreditationId,
            status: universityStatusLabel(university.status),
          }
        : null,
      diploma: parsedPayload.success ? parsedPayload.data : null,
      chain: {
        id: chainId,
        registry,
      },
    });
  } catch (e: unknown) {
    return NextResponse.json(
      { error: `Verification failed: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 }
    );
  }
}
