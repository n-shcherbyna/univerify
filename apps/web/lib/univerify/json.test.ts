import { describe, it, expect } from "vitest";
import type { Hex } from "viem";
import { validateDiplomaEnvelope, parseJson } from "./json";

const VALID_PROOF_ENTRY = ("0x" + "ab".repeat(32)) as Hex;

const VALID_ENVELOPE = {
  payload: {
    student: { firstName: "Jan", lastName: "Kowalski", studentId: "s123456" },
    degree: { name: "Bachelor of Computer Science", level: "BSc" },
    issuedAt: "2025-06-30",
    diplomaNumber: "UV-2025-000123",
  },
  proof: {
    type: "MERKLE_BATCH" as const,
    batchId: 1,
    proof: [VALID_PROOF_ENTRY],
    issuer: "0x1234567890123456789012345678901234567890" as `0x${string}`,
  },
};

// ─── validateDiplomaEnvelope ─────────────────────────────────────────────────

describe("validateDiplomaEnvelope — accepts valid envelope", () => {
  it("returns a typed DiplomaEnvelope", () => {
    const env = validateDiplomaEnvelope(VALID_ENVELOPE);
    expect(env.proof.batchId).toBe(1);
    expect(env.payload.diplomaNumber).toBe("UV-2025-000123");
    expect(env.proof.proof).toHaveLength(1);
  });

  it("accepts empty proof array (single-diploma batch)", () => {
    const env = validateDiplomaEnvelope({ ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, proof: [] } });
    expect(env.proof.proof).toHaveLength(0);
  });

  it("accepts batchId = 0", () => {
    expect(() =>
      validateDiplomaEnvelope({ ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, batchId: 0 } })
    ).not.toThrow();
  });
});

describe("validateDiplomaEnvelope — top-level structure", () => {
  it("rejects null", () => {
    expect(() => validateDiplomaEnvelope(null)).toThrow();
  });

  it("rejects a string", () => {
    expect(() => validateDiplomaEnvelope("string")).toThrow();
  });

  it("rejects missing payload", () => {
    const { payload: _payload, ...bad } = VALID_ENVELOPE;
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/payload/i);
  });

  it("rejects missing proof", () => {
    const { proof: _proof, ...bad } = VALID_ENVELOPE;
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/proof/i);
  });
});

describe("validateDiplomaEnvelope — proof validation", () => {
  it("rejects unsupported proof type EIP712", () => {
    const bad = { ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, type: "EIP712" as const } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/MERKLE_BATCH/i);
  });

  it("rejects non-object proof", () => {
    expect(() => validateDiplomaEnvelope({ ...VALID_ENVELOPE, proof: "not-object" })).toThrow();
  });

  it("rejects invalid issuer address", () => {
    const bad = { ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, issuer: "not-an-address" } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/issuer/i);
  });

  it("rejects negative batchId", () => {
    const bad = { ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, batchId: -1 } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/batchId/i);
  });

  it("rejects non-integer batchId", () => {
    const bad = { ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, batchId: 1.5 } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow();
  });

  it("rejects proof array with > 64 nodes", () => {
    const bigProof = Array(65).fill(VALID_PROOF_ENTRY) as Hex[];
    const bad = { ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, proof: bigProof } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/64/);
  });

  it("rejects proof entry that is not bytes32 (too short)", () => {
    const bad = { ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, proof: ["0xaabbcc" as Hex] } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/bytes32/i);
  });

  it("rejects proof entry that is not hex", () => {
    const bad = { ...VALID_ENVELOPE, proof: { ...VALID_ENVELOPE.proof, proof: ["not-hex" as Hex] } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow();
  });
});

describe("validateDiplomaEnvelope — payload Zod validation", () => {
  it("rejects payload missing required fields", () => {
    const bad = { ...VALID_ENVELOPE, payload: { wrong: "schema" } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/Invalid diploma payload/i);
  });

  it("rejects payload with empty firstName", () => {
    const bad = {
      ...VALID_ENVELOPE,
      payload: { ...VALID_ENVELOPE.payload, student: { ...VALID_ENVELOPE.payload.student, firstName: "" } },
    };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/Invalid diploma payload/i);
  });

  it("rejects payload with invalid date format", () => {
    const bad = { ...VALID_ENVELOPE, payload: { ...VALID_ENVELOPE.payload, issuedAt: "30/06/2025" } };
    expect(() => validateDiplomaEnvelope(bad)).toThrow(/Invalid diploma payload/i);
  });

  it("error message contains the failing field path", () => {
    const bad = { ...VALID_ENVELOPE, payload: { ...VALID_ENVELOPE.payload, diplomaNumber: "" } };
    try {
      validateDiplomaEnvelope(bad);
      expect.fail("should have thrown");
    } catch (e: unknown) {
      expect((e as Error).message).toContain("diplomaNumber");
    }
  });
});

// ─── parseJson ───────────────────────────────────────────────────────────────

describe("parseJson", () => {
  it("parses valid JSON object", () => {
    const r = parseJson<{ a: number }>('{"a":1}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.a).toBe(1);
  });

  it("parses valid JSON array", () => {
    const r = parseJson<number[]>("[1,2,3]");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toHaveLength(3);
  });

  it("returns ok=false for invalid JSON", () => {
    expect(parseJson("{invalid}").ok).toBe(false);
    expect(parseJson("").ok).toBe(false);
    expect(parseJson("undefined").ok).toBe(false);
  });

  it("returns error string for invalid JSON", () => {
    const r = parseJson("{bad}");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBeTruthy();
  });
});
