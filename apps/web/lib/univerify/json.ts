import { isAddress, type Address } from "viem";
import { DiplomaPayloadSchema, formatZodError } from "./schema";
import type { DiplomaEnvelope, PrivateDiplomaEnvelope } from "./types";
import { DISCLOSURE_FIELDS } from "@univerify/verifier-core";

export function parseJson<T = unknown>(text: string): { ok: true; value: T } | { ok: false; error: string } {
  try {
    return { ok: true, value: JSON.parse(text) as T };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

export function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function isBytes32Hex(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validation function accepting arbitrary input
export function validateDiplomaEnvelope(obj: any): DiplomaEnvelope {
  if (!obj || typeof obj !== "object") throw new Error("Envelope must be an object.");
  if (!("payload" in obj)) throw new Error('Envelope missing "payload".');
  if (!("proof" in obj)) throw new Error('Envelope missing "proof".');

  const proof = obj.proof;
  if (!proof || typeof proof !== "object") throw new Error('"proof" must be an object.');
  if (proof.type !== "MERKLE_BATCH") throw new Error(`Unsupported proof.type: "${proof.type}". Expected "MERKLE_BATCH".`);
  if (!Number.isInteger(proof.batchId) || proof.batchId < 0) throw new Error("Invalid proof.batchId.");
  if (!Array.isArray(proof.proof)) throw new Error("proof.proof must be an array.");
  if (proof.proof.length > 64) throw new Error("proof.proof is unreasonably large (max 64 nodes).");
  for (const sib of proof.proof) {
    if (!isBytes32Hex(sib)) throw new Error("proof.proof[] entries must be bytes32 hex.");
  }
  if (typeof proof.issuer !== "string" || !isAddress(proof.issuer)) throw new Error("proof.issuer must be a valid address.");

  let payload;
  try {
    payload = DiplomaPayloadSchema.parse(obj.payload);
  } catch (e: unknown) {
    throw new Error(`Invalid diploma payload: ${formatZodError(e)}`);
  }

  return {
    payload,
    proof: {
      type: proof.type,
      batchId: proof.batchId,
      proof: proof.proof,
      issuer: proof.issuer,
    },
  };
}

export function normalizeAddress(a: Address): string {
  return a.toLowerCase();
}

export function isPrivateEnvelope(obj: unknown): boolean {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "commitments" in obj &&
    !("payload" in obj)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- validation function accepting arbitrary input
export function validatePrivateEnvelope(obj: any): PrivateDiplomaEnvelope {
  if (!obj || typeof obj !== "object") throw new Error("Envelope must be an object.");
  if (!("commitments" in obj)) throw new Error('Envelope missing "commitments".');
  if (!("disclosed" in obj)) throw new Error('Envelope missing "disclosed".');
  if (!("proof" in obj)) throw new Error('Envelope missing "proof".');

  // Validate commitments: must have all 4 disclosure fields as bytes32 hex
  const commitments = obj.commitments;
  if (!commitments || typeof commitments !== "object") throw new Error('"commitments" must be an object.');
  for (const field of DISCLOSURE_FIELDS) {
    if (!isBytes32Hex(commitments[field])) {
      throw new Error(`commitments.${field} must be a bytes32 hex string.`);
    }
  }

  // Validate disclosed: each present field must have value + salt (salt = bytes32 hex)
  const disclosed = obj.disclosed;
  if (!disclosed || typeof disclosed !== "object") throw new Error('"disclosed" must be an object.');
  for (const key of Object.keys(disclosed)) {
    if (!(DISCLOSURE_FIELDS as readonly string[]).includes(key)) {
      throw new Error(`disclosed contains unknown field "${key}".`);
    }
    const entry = disclosed[key];
    if (!entry || typeof entry !== "object") throw new Error(`disclosed.${key} must be an object.`);
    if (!("value" in entry)) throw new Error(`disclosed.${key} missing "value".`);
    if (!("salt" in entry)) throw new Error(`disclosed.${key} missing "salt".`);
    if (!isBytes32Hex(entry.salt)) throw new Error(`disclosed.${key}.salt must be a bytes32 hex string.`);
  }

  // Validate proof (same rules as standard envelope)
  const proof = obj.proof;
  if (!proof || typeof proof !== "object") throw new Error('"proof" must be an object.');
  if (proof.type !== "MERKLE_BATCH") throw new Error(`Unsupported proof.type: "${proof.type}". Expected "MERKLE_BATCH".`);
  if (!Number.isInteger(proof.batchId) || proof.batchId < 0) throw new Error("Invalid proof.batchId.");
  if (!Array.isArray(proof.proof)) throw new Error("proof.proof must be an array.");
  if (proof.proof.length > 64) throw new Error("proof.proof is unreasonably large (max 64 nodes).");
  for (const sib of proof.proof) {
    if (!isBytes32Hex(sib)) throw new Error("proof.proof[] entries must be bytes32 hex.");
  }
  if (typeof proof.issuer !== "string" || !isAddress(proof.issuer)) throw new Error("proof.issuer must be a valid address.");

  return {
    commitments: {
      student: commitments.student,
      degree: commitments.degree,
      issuedAt: commitments.issuedAt,
      diplomaNumber: commitments.diplomaNumber,
    },
    disclosed,
    proof: {
      type: proof.type,
      batchId: proof.batchId,
      proof: proof.proof,
      issuer: proof.issuer,
    },
  };
}
