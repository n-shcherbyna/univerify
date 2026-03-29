import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "./route";

// Mock the registry module to avoid real RPC calls
vi.mock("@/lib/univerify/registry", () => ({
  makePublicClient: vi.fn(() => ({})),
  readStatusWithProof: vi.fn(async () => 1 as const),
  readBatch: vi.fn(async () => ({
    issuer: "0x0000000000000000000000000000000000000001",
    merkleRoot: "0x" + "ab".repeat(32),
  })),
  readIsIssuer: vi.fn(async () => true),
  readIssuerUniversityId: vi.fn(async () => 0n),
  readIsRevoked: vi.fn(async () => false),
  readUniversityMeta: vi.fn(async () => null),
  statusLabel: vi.fn((code: number) =>
    code === 0 ? "Unknown" : code === 1 ? "Valid" : "Revoked"
  ),
  universityStatusLabel: vi.fn(() => "Unknown"),
}));

vi.mock("@/lib/univerify/env", () => ({
  readPublicEnv: vi.fn(() => ({
    rpcUrl: "https://rpc.example.com",
    registry: "0x0000000000000000000000000000000000000001",
    chainId: 11155111,
    deployBlock: 0n,
  })),
}));

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const VALID_ENVELOPE = {
  payload: {
    student: { firstName: "Alice", lastName: "Smith", studentId: "S001" },
    degree: { name: "Computer Science", level: "BSc" },
    issuedAt: "2025-06-01",
    diplomaNumber: "D-001",
  },
  proof: {
    type: "MERKLE_BATCH",
    batchId: 1,
    issuer: "0x0000000000000000000000000000000000000001",
    proof: [],
  },
};

// ─── Input validation ────────────────────────────────────────────────────────

describe("POST /api/verify — input validation", () => {
  it("returns 400 for non-JSON body", async () => {
    const req = new NextRequest("http://localhost:3000/api/verify", {
      method: "POST",
      body: "not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/JSON/i);
  });

  it("returns 400 for missing payload", async () => {
    const res = await POST(makeRequest({ proof: VALID_ENVELOPE.proof }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/payload/i);
  });

  it("returns 400 for missing proof", async () => {
    const res = await POST(makeRequest({ payload: VALID_ENVELOPE.payload }));
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/proof/i);
  });

  it("returns 400 for invalid proof type", async () => {
    const res = await POST(
      makeRequest({
        payload: VALID_ENVELOPE.payload,
        proof: { ...VALID_ENVELOPE.proof, type: "INVALID" },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/MERKLE_BATCH/);
  });

  it("returns 400 for invalid issuer address", async () => {
    const res = await POST(
      makeRequest({
        payload: VALID_ENVELOPE.payload,
        proof: { ...VALID_ENVELOPE.proof, issuer: "not-an-address" },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/issuer/i);
  });

  it("returns 400 for negative batchId", async () => {
    const res = await POST(
      makeRequest({
        payload: VALID_ENVELOPE.payload,
        proof: { ...VALID_ENVELOPE.proof, batchId: -1 },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/batchId/i);
  });

  it("returns 400 for invalid diploma payload", async () => {
    const res = await POST(
      makeRequest({
        payload: { student: {} },
        proof: VALID_ENVELOPE.proof,
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/payload/i);
  });

  it("returns 400 for oversized proof array", async () => {
    const res = await POST(
      makeRequest({
        payload: VALID_ENVELOPE.payload,
        proof: {
          ...VALID_ENVELOPE.proof,
          proof: Array(65).fill("0x" + "aa".repeat(32)),
        },
      })
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toMatch(/large/i);
  });
});

// ─── Successful verification ─────────────────────────────────────────────────

describe("POST /api/verify — success path", () => {
  it("returns 200 with verification result for valid envelope", async () => {
    const res = await POST(makeRequest(VALID_ENVELOPE));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toHaveProperty("verified");
    expect(data).toHaveProperty("status");
    expect(data).toHaveProperty("docHash");
    expect(data).toHaveProperty("issuer");
    expect(data).toHaveProperty("batchId", 1);
    expect(data).toHaveProperty("merkle");
    expect(data).toHaveProperty("chain");
    expect(data.docHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(data.status.code).toBe(1);
    expect(data.status.label).toBe("Valid");
  });

  it("includes diploma payload in response", async () => {
    const res = await POST(makeRequest(VALID_ENVELOPE));
    const data = await res.json();
    expect(data.diploma).toEqual(VALID_ENVELOPE.payload);
  });

  it("includes merkle validation fields", async () => {
    const res = await POST(makeRequest(VALID_ENVELOPE));
    const data = await res.json();
    expect(data.merkle).toHaveProperty("leaf");
    expect(data.merkle).toHaveProperty("computedRoot");
    expect(data.merkle).toHaveProperty("onChainRoot");
    expect(data.merkle).toHaveProperty("rootMatches");
  });
});
