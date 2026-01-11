import { isAddress, type Address } from "viem";
import type { DiplomaEnvelopeEip712 } from "./types";

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

export function validateEip712Envelope(obj: any): DiplomaEnvelopeEip712 {
  requireObject(obj, "Envelope must be an object");
  if (!("payload" in obj)) throw new Error('Envelope missing "payload"');
  if (!("proof" in obj)) throw new Error('Envelope missing "proof"');

  const proof = (obj as any).proof;
  requireObject(proof, '"proof" must be an object');
  if (proof.type !== "EIP712") throw new Error('Unsupported proof.type (expected "EIP712")');

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

  // Minimal check that required type exists (shape checking is done by viem during recovery)
  if (!types.Diploma || !Array.isArray(types.Diploma)) {
    throw new Error('Invalid proof.types (missing "Diploma" definition)');
  }

  return obj as DiplomaEnvelopeEip712;
}

export function normalizeAddress(a: Address): string {
  return a.toLowerCase();
}