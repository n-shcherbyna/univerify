import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

vi.mock("@/lib/univerify/registry", () => ({
  makePublicClient: vi.fn(() => ({})),
  readStatusWithProof: vi.fn(async () => 1 as const),
  readBatch: vi.fn(async () => ({
    issuer: "0x0000000000000000000000000000000000000001",
    merkleRoot: "0x" + "ab".repeat(32),
  })),
  readIsRevoked: vi.fn(async () => false),
  statusLabel: vi.fn((code: number) =>
    code === 0 ? "Unknown" : code === 1 ? "Valid" : "Revoked"
  ),
}));

vi.mock("@/lib/univerify/env", () => ({
  readPublicEnv: vi.fn(() => ({
    rpcUrl: "https://rpc.example.com",
    registry: "0x0000000000000000000000000000000000000001",
    chainId: 11155111,
    deployBlock: 0n,
  })),
}));

const VALID_DOC_HASH = "0x" + "aa".repeat(32);
const VALID_ISSUER = "0x0000000000000000000000000000000000000001";

function makeUrl(params: Record<string, string>): string {
  const url = new URL("http://localhost:3000/api/status");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

function makeRequest(params: Record<string, string>): NextRequest {
  return new NextRequest(makeUrl(params));
}

// ─── Input validation ────────────────────────────────────────────────────────

describe("GET /api/status — input validation", () => {
  it("returns 400 when docHash is missing", async () => {
    const res = await GET(makeRequest({ issuer: VALID_ISSUER, batchId: "1" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/docHash/i);
  });

  it("returns 400 when docHash is not bytes32", async () => {
    const res = await GET(
      makeRequest({ docHash: "0xbeef", issuer: VALID_ISSUER, batchId: "1" })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/docHash/i);
  });

  it("returns 400 when issuer is missing", async () => {
    const res = await GET(makeRequest({ docHash: VALID_DOC_HASH, batchId: "1" }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/issuer/i);
  });

  it("returns 400 when issuer is not a valid address", async () => {
    const res = await GET(
      makeRequest({ docHash: VALID_DOC_HASH, issuer: "0xnotanaddress", batchId: "1" })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/issuer/i);
  });

  it("returns 400 when batchId is missing", async () => {
    const res = await GET(
      makeRequest({ docHash: VALID_DOC_HASH, issuer: VALID_ISSUER })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/batchId/i);
  });

  it("returns 400 when batchId is negative", async () => {
    const res = await GET(
      makeRequest({ docHash: VALID_DOC_HASH, issuer: VALID_ISSUER, batchId: "-1" })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/batchId/i);
  });

  it("returns 400 when proof node is invalid hex", async () => {
    const res = await GET(
      makeRequest({
        docHash: VALID_DOC_HASH,
        issuer: VALID_ISSUER,
        batchId: "1",
        proof: "0xnothex",
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/proof/i);
  });

  it("returns 400 when proof has too many nodes", async () => {
    const proof = Array(65).fill("0x" + "bb".repeat(32)).join(",");
    const res = await GET(
      makeRequest({
        docHash: VALID_DOC_HASH,
        issuer: VALID_ISSUER,
        batchId: "1",
        proof,
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/large/i);
  });
});

// ─── Success path ────────────────────────────────────────────────────────────

describe("GET /api/status — success path", () => {
  it("returns 200 with status for valid params (no proof)", async () => {
    const res = await GET(
      makeRequest({
        docHash: VALID_DOC_HASH,
        issuer: VALID_ISSUER,
        batchId: "1",
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("status");
    expect(data.status.code).toBe(1);
    expect(data.status.label).toBe("Valid");
    expect(data).toHaveProperty("docHash", VALID_DOC_HASH);
    expect(data).toHaveProperty("revoked", false);
    expect(data).toHaveProperty("merkle");
    expect(data).toHaveProperty("chain");
  });

  it("returns 200 with proof nodes", async () => {
    const proofNode = "0x" + "cc".repeat(32);
    const res = await GET(
      makeRequest({
        docHash: VALID_DOC_HASH,
        issuer: VALID_ISSUER,
        batchId: "1",
        proof: proofNode,
      })
    );
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.merkle).toHaveProperty("leaf");
    expect(data.merkle).toHaveProperty("computedRoot");
    expect(data.merkle).toHaveProperty("onChainRoot");
    expect(data.merkle).toHaveProperty("rootMatches");
  });

  it("includes chain info in response", async () => {
    const res = await GET(
      makeRequest({
        docHash: VALID_DOC_HASH,
        issuer: VALID_ISSUER,
        batchId: "1",
      })
    );
    const data = await res.json();
    expect(data.chain.id).toBe(11155111);
    expect(data.chain.registry).toBe("0x0000000000000000000000000000000000000001");
  });
});
