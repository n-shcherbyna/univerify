import { isAddress, type Address } from "viem";
import type { DiplomaEnvelope, DiplomaEnvelopeEip712, DiplomaEnvelopeMerkleBatch } from "./types";

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


function requireObject(v: any, msg: string) {
    if (!v || typeof v !== "object") throw new Error(msg);
}

function isBytes32Hex(v: unknown): v is `0x${string}` {
  return typeof v === "string" && /^0x[0-9a-fA-F]{64}$/.test(v);
}

export function validateEip712Envelope(obj: any): DiplomaEnvelopeEip712 {
  requireObject(obj, "Envelope must be an object");
  if (!("payload" in obj)) throw new Error('Envelope missing "payload"');
  if (!("proof" in obj)) throw new Error('Envelope missing "proof"');

  const proof = (obj as any).proof;
  requireObject(proof, '"proof" must be an object');
  if (proof.type !== "EIP712") throw new Error('Unsupported proof.type (expected "EIP712")');

  if ("issuer" in proof) {
    if (typeof proof.issuer !== "string" || !isAddress(proof.issuer)) {
      throw new Error("Invalid proof.issuer (must be address when provided)");
    }
  }

  const domain = proof.domain;
  requireObject(domain, "Missing proof.domain");
  if (typeof domain.name !== "string") throw new Error("Invalid proof.domain.name");
  if (typeof domain.version !== "string") throw new Error("Invalid proof.domain.version");
  if (typeof domain.chainId !== "number") throw new Error("Invalid proof.domain.chainId");
  if (typeof domain.verifyingContract !== "string" || !isAddress(domain.verifyingContract)) {
    throw new Error("Invalid proof.domain.verifyingContract");
  }

  const types = proof.types;
  requireObject(types, "Missing proof.types");

  if (proof.primaryType !== "Diploma") {
    throw new Error('Invalid proof.primaryType (expected "Diploma")');
  }

  if (typeof proof.signature !== "string" || !proof.signature.startsWith("0x")) {
    throw new Error('Invalid proof.signature (expected 0x...)');
  }

  if ("merkle" in proof && proof.merkle != null) {
    const merkle = proof.merkle;
    requireObject(merkle, "Invalid proof.merkle");

    if (!Number.isInteger(merkle.batchId) || merkle.batchId < 0) {
      throw new Error("Invalid proof.merkle.batchId");
    }

    if (!Array.isArray(merkle.proof)) {
      throw new Error("Invalid proof.merkle.proof");
    }

    for (const sib of merkle.proof) {
      if (!isBytes32Hex(sib)) {
        throw new Error("Invalid proof.merkle.proof[] entry (expected bytes32 hex)");
      }
    }
  }

  // Minimal check that required type exists (shape checking is done by viem during recovery)
  if (!types.Diploma || !Array.isArray(types.Diploma)) {
    throw new Error('Invalid proof.types (missing "Diploma" definition)');
  }

  return obj as DiplomaEnvelopeEip712;
}

export function validateDiplomaEnvelope(obj: any): DiplomaEnvelope {
  requireObject(obj, "Envelope must be an object");
  if (!("payload" in obj)) throw new Error('Envelope missing "payload"');
  if (!("proof" in obj)) throw new Error('Envelope missing "proof"');

  const proof = (obj as any).proof;
  requireObject(proof, '"proof" must be an object');
  if (typeof proof.type !== "string") throw new Error('Invalid proof.type');

  if (proof.type === "EIP712") {
    return validateEip712Envelope(obj);
  }

  if (proof.type === "MERKLE_BATCH") {
    if (!Number.isInteger(proof.batchId) || proof.batchId < 0) {
      throw new Error("Invalid proof.batchId");
    }
    if (!Array.isArray(proof.proof)) {
      throw new Error("Invalid proof.proof");
    }
    for (const sib of proof.proof) {
      if (!isBytes32Hex(sib)) {
        throw new Error("Invalid proof.proof[] entry (expected bytes32 hex)");
      }
    }

    if (typeof proof.issuer !== "string" || !isAddress(proof.issuer)) {
      throw new Error("Invalid proof.issuer (required address)");
    }

    if (proof.eip712 != null) {
      requireObject(proof.eip712, "Invalid proof.eip712");
      const e = proof.eip712;
      requireObject(e.domain, "Missing proof.eip712.domain");
      if (typeof e.domain.name !== "string") throw new Error("Invalid proof.eip712.domain.name");
      if (typeof e.domain.version !== "string") throw new Error("Invalid proof.eip712.domain.version");
      if (typeof e.domain.chainId !== "number") throw new Error("Invalid proof.eip712.domain.chainId");
      if (typeof e.domain.verifyingContract !== "string" || !isAddress(e.domain.verifyingContract)) {
        throw new Error("Invalid proof.eip712.domain.verifyingContract");
      }
      requireObject(e.types, "Missing proof.eip712.types");
      if (!e.types.Diploma || !Array.isArray(e.types.Diploma)) {
        throw new Error('Invalid proof.eip712.types (missing "Diploma" definition)');
      }
      if (e.primaryType !== "Diploma") {
        throw new Error('Invalid proof.eip712.primaryType (expected "Diploma")');
      }
      if (typeof e.signature !== "string" || !e.signature.startsWith("0x")) {
        throw new Error("Invalid proof.eip712.signature");
      }
    }

    return obj as DiplomaEnvelopeMerkleBatch;
  }

  throw new Error(`Unsupported proof.type: ${proof.type}`);
}

export function normalizeAddress(a: Address): string {
  return a.toLowerCase();
}
