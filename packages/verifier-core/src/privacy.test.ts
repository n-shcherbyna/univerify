import { describe, expect, it } from "vitest";
import { encodePacked, keccak256, toBytes, toHex } from "viem";
import { canonicalize } from "json-canonicalize";
import type { DiplomaPayload } from "./schema.js";
import { hashPayload } from "./hash.js";
import { buildMerkleFromLeaves, computeMerkleLeaf, computeRootFromProof } from "./merkle.js";
import {
  DISCLOSURE_FIELDS,
  computeFieldCommitments,
  computePrivateDocHash,
  generateFieldSalts,
  verifyDisclosedFields,
  type DisclosedFields,
  type FieldSalts,
} from "./privacy.js";

/* ------------------------------------------------------------------ */
/*  Fixtures                                                           */
/* ------------------------------------------------------------------ */

const PAYLOAD: DiplomaPayload = {
  student: { firstName: "Alice", lastName: "Smith", studentId: "S12345" },
  degree: { name: "Computer Science", level: "Bachelor" },
  issuedAt: "2025-06-15",
  diplomaNumber: "DIP-001",
};

const PAYLOAD_2: DiplomaPayload = {
  student: { firstName: "Bob", lastName: "Jones", studentId: "S99999" },
  degree: { name: "Mathematics", level: "Master" },
  issuedAt: "2025-09-01",
  diplomaNumber: "DIP-002",
};

/* ------------------------------------------------------------------ */
/*  generateFieldSalts                                                 */
/* ------------------------------------------------------------------ */

describe("generateFieldSalts", () => {
  it("returns 4 unique 32-byte hex salts", () => {
    const salts = generateFieldSalts();
    const values = DISCLOSURE_FIELDS.map((f) => salts[f]);

    expect(values).toHaveLength(4);
    for (const v of values) {
      expect(v).toMatch(/^0x[0-9a-f]{64}$/);
    }

    // all unique
    expect(new Set(values).size).toBe(4);
  });

  it("produces different salts on each call", () => {
    const a = generateFieldSalts();
    const b = generateFieldSalts();
    // extremely unlikely to collide
    expect(a.student).not.toBe(b.student);
  });
});

/* ------------------------------------------------------------------ */
/*  computeFieldCommitments                                            */
/* ------------------------------------------------------------------ */

describe("computeFieldCommitments", () => {
  it("returns 4 bytes32 commitments", () => {
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);

    for (const field of DISCLOSURE_FIELDS) {
      expect(commitments[field]).toMatch(/^0x[0-9a-f]{64}$/);
    }
  });

  it("matches manual keccak256(encodePacked(canonicalize(field), salt))", () => {
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);

    const manualStudent = keccak256(
      encodePacked(["bytes", "bytes32"], [toHex(toBytes(canonicalize(PAYLOAD.student))), salts.student]),
    );
    expect(commitments.student).toBe(manualStudent);

    const manualIssuedAt = keccak256(
      encodePacked(
        ["bytes", "bytes32"],
        [toHex(toBytes(canonicalize(PAYLOAD.issuedAt))), salts.issuedAt],
      ),
    );
    expect(commitments.issuedAt).toBe(manualIssuedAt);
  });

  it("different salts produce different commitments", () => {
    const saltsA = generateFieldSalts();
    const saltsB = generateFieldSalts();
    const a = computeFieldCommitments(PAYLOAD, saltsA);
    const b = computeFieldCommitments(PAYLOAD, saltsB);
    expect(a.student).not.toBe(b.student);
  });

  it("different payloads produce different commitments", () => {
    const salts = generateFieldSalts();
    const a = computeFieldCommitments(PAYLOAD, salts);
    const b = computeFieldCommitments(PAYLOAD_2, salts);
    expect(a.student).not.toBe(b.student);
    expect(a.degree).not.toBe(b.degree);
  });
});

/* ------------------------------------------------------------------ */
/*  computePrivateDocHash                                              */
/* ------------------------------------------------------------------ */

describe("computePrivateDocHash", () => {
  it("returns a bytes32 hex string", () => {
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);
    const hash = computePrivateDocHash(commitments);
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("equals keccak256 of the 4 commitments packed", () => {
    const salts = generateFieldSalts();
    const c = computeFieldCommitments(PAYLOAD, salts);
    const hash = computePrivateDocHash(c);

    const expected = keccak256(
      encodePacked(
        ["bytes32", "bytes32", "bytes32", "bytes32"],
        [c.student, c.degree, c.issuedAt, c.diplomaNumber],
      ),
    );
    expect(hash).toBe(expected);
  });

  it("is deterministic", () => {
    const salts = generateFieldSalts();
    const c = computeFieldCommitments(PAYLOAD, salts);
    expect(computePrivateDocHash(c)).toBe(computePrivateDocHash(c));
  });

  it("differs from standard hashPayload", () => {
    const salts = generateFieldSalts();
    const c = computeFieldCommitments(PAYLOAD, salts);
    const privateHash = computePrivateDocHash(c);
    const standardHash = hashPayload(PAYLOAD);
    expect(privateHash).not.toBe(standardHash);
  });
});

/* ------------------------------------------------------------------ */
/*  verifyDisclosedFields                                              */
/* ------------------------------------------------------------------ */

describe("verifyDisclosedFields", () => {
  it("returns true for a correctly disclosed single field", () => {
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);

    const disclosed: DisclosedFields = {
      student: { value: PAYLOAD.student, salt: salts.student },
    };
    expect(verifyDisclosedFields(disclosed, commitments)).toBe(true);
  });

  it("returns true for empty disclosure", () => {
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);
    expect(verifyDisclosedFields({}, commitments)).toBe(true);
  });

  it("returns true when all 4 fields are disclosed", () => {
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);

    const disclosed: DisclosedFields = {
      student: { value: PAYLOAD.student, salt: salts.student },
      degree: { value: PAYLOAD.degree, salt: salts.degree },
      issuedAt: { value: PAYLOAD.issuedAt, salt: salts.issuedAt },
      diplomaNumber: { value: PAYLOAD.diplomaNumber, salt: salts.diplomaNumber },
    };
    expect(verifyDisclosedFields(disclosed, commitments)).toBe(true);
  });

  it("returns false for a tampered value", () => {
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);

    const disclosed: DisclosedFields = {
      student: {
        value: { firstName: "Evil", lastName: "Hacker", studentId: "S12345" },
        salt: salts.student,
      },
    };
    expect(verifyDisclosedFields(disclosed, commitments)).toBe(false);
  });

  it("returns false for a wrong salt", () => {
    const salts = generateFieldSalts();
    const wrongSalts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);

    const disclosed: DisclosedFields = {
      degree: { value: PAYLOAD.degree, salt: wrongSalts.degree },
    };
    expect(verifyDisclosedFields(disclosed, commitments)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/*  Integration: privacy + Merkle                                      */
/* ------------------------------------------------------------------ */

describe("Integration: private docHash with Merkle tree", () => {
  const REGISTRY = "0x0000000000000000000000000000000000000001" as const;
  const CHAIN_ID = 11155111n;
  const ISSUER = "0x0000000000000000000000000000000000000002" as const;
  const BATCH_ID = 1n;

  it("builds a 2-leaf Merkle tree from private docHashes and verifies proofs", () => {
    const salts1 = generateFieldSalts();
    const salts2 = generateFieldSalts();
    const c1 = computeFieldCommitments(PAYLOAD, salts1);
    const c2 = computeFieldCommitments(PAYLOAD_2, salts2);
    const docHash1 = computePrivateDocHash(c1);
    const docHash2 = computePrivateDocHash(c2);

    const leaf1 = computeMerkleLeaf({
      registry: REGISTRY,
      chainId: CHAIN_ID,
      issuer: ISSUER,
      batchId: BATCH_ID,
      docHash: docHash1,
    });
    const leaf2 = computeMerkleLeaf({
      registry: REGISTRY,
      chainId: CHAIN_ID,
      issuer: ISSUER,
      batchId: BATCH_ID,
      docHash: docHash2,
    });

    const { root, proofs } = buildMerkleFromLeaves([leaf1, leaf2]);

    // Both proofs reconstruct the root
    expect(computeRootFromProof({ leaf: leaf1, proof: proofs[0] })).toBe(root);
    expect(computeRootFromProof({ leaf: leaf2, proof: proofs[1] })).toBe(root);
  });

  it("selective disclosure end-to-end with Merkle proof", () => {
    // --- Issuer side: generate commitments, build tree ---
    const salts = generateFieldSalts();
    const commitments = computeFieldCommitments(PAYLOAD, salts);
    const docHash = computePrivateDocHash(commitments);

    const leaf = computeMerkleLeaf({
      registry: REGISTRY,
      chainId: CHAIN_ID,
      issuer: ISSUER,
      batchId: BATCH_ID,
      docHash,
    });
    const { root, proofs } = buildMerkleFromLeaves([leaf]);

    // --- Holder side: selectively disclose degree only ---
    const disclosed: DisclosedFields = {
      degree: { value: PAYLOAD.degree, salt: salts.degree },
    };

    // --- Verifier side ---
    // 1. Verify disclosed fields against commitments
    expect(verifyDisclosedFields(disclosed, commitments)).toBe(true);

    // 2. Recompute private docHash from commitments
    const recomputedDocHash = computePrivateDocHash(commitments);
    expect(recomputedDocHash).toBe(docHash);

    // 3. Recompute leaf and verify Merkle proof
    const recomputedLeaf = computeMerkleLeaf({
      registry: REGISTRY,
      chainId: CHAIN_ID,
      issuer: ISSUER,
      batchId: BATCH_ID,
      docHash: recomputedDocHash,
    });
    expect(computeRootFromProof({ leaf: recomputedLeaf, proof: proofs[0] })).toBe(root);
  });
});
