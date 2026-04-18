import { canonicalize } from "json-canonicalize";
import { encodePacked, keccak256, toHex, toBytes, type Hex } from "viem";
import type { DiplomaPayload } from "./schema.js";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export const DISCLOSURE_FIELDS = ["student", "degree", "issuedAt", "diplomaNumber"] as const;
export type DisclosureField = (typeof DISCLOSURE_FIELDS)[number];
export type FieldSalts = Record<DisclosureField, Hex>;
export type FieldCommitments = Record<DisclosureField, Hex>;

export type DisclosedEntry<K extends DisclosureField = DisclosureField> = {
  value: K extends "student"
    ? DiplomaPayload["student"]
    : K extends "degree"
      ? DiplomaPayload["degree"]
      : string;
  salt: Hex;
};

export type DisclosedFields = {
  [K in DisclosureField]?: DisclosedEntry<K>;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function fieldCommitment(fieldValue: unknown, salt: Hex): Hex {
  return keccak256(
    encodePacked(["bytes", "bytes32"], [toHex(toBytes(canonicalize(fieldValue))), salt]),
  );
}

/* ------------------------------------------------------------------ */
/*  Public functions                                                   */
/* ------------------------------------------------------------------ */

/**
 * Generate 4 cryptographically random 32-byte hex salts, one per disclosure field.
 */
export function generateFieldSalts(): FieldSalts {
  const salts = {} as Record<DisclosureField, Hex>;
  for (const field of DISCLOSURE_FIELDS) {
    const buf = new Uint8Array(32);
    crypto.getRandomValues(buf);
    salts[field] = `0x${Array.from(buf)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")}` as Hex;
  }
  return salts;
}

/**
 * Compute a hiding commitment for each diploma field:
 *   commitment = keccak256(encodePacked([bytes, bytes32], [canonicalize(fieldValue), salt]))
 */
export function computeFieldCommitments(
  payload: DiplomaPayload,
  salts: FieldSalts,
): FieldCommitments {
  return {
    student: fieldCommitment(payload.student, salts.student),
    degree: fieldCommitment(payload.degree, salts.degree),
    issuedAt: fieldCommitment(payload.issuedAt, salts.issuedAt),
    diplomaNumber: fieldCommitment(payload.diplomaNumber, salts.diplomaNumber),
  };
}

/**
 * Derive a privacy-preserving document hash from field commitments.
 *   docHash = keccak256(encodePacked([bytes32 x4], [student, degree, issuedAt, diplomaNumber]))
 */
export function computePrivateDocHash(commitments: FieldCommitments): Hex {
  return keccak256(
    encodePacked(
      ["bytes32", "bytes32", "bytes32", "bytes32"],
      [commitments.student, commitments.degree, commitments.issuedAt, commitments.diplomaNumber],
    ),
  );
}

/**
 * Verify that disclosed field values match the corresponding commitments.
 * Returns true when every disclosed field recomputes to its commitment.
 * An empty disclosure object trivially returns true.
 */
export function verifyDisclosedFields(
  disclosed: DisclosedFields,
  commitments: FieldCommitments,
): boolean {
  for (const field of DISCLOSURE_FIELDS) {
    const entry = disclosed[field];
    if (entry == null) continue;
    const recomputed = fieldCommitment(entry.value, entry.salt);
    if (recomputed !== commitments[field]) return false;
  }
  return true;
}
