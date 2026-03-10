import { isAddress, type Address } from "viem";
import type { DiplomaEnvelope } from "./types";

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

export function validateDiplomaEnvelope(obj: any): DiplomaEnvelope {
  if (!obj || typeof obj !== "object") throw new Error("Envelope must be an object.");
  if (!("payload" in obj)) throw new Error('Envelope missing "payload".');
  if (!("proof" in obj)) throw new Error('Envelope missing "proof".');

  const proof = obj.proof;
  if (!proof || typeof proof !== "object") throw new Error('"proof" must be an object.');
  if (proof.type !== "MERKLE_BATCH") throw new Error(`Unsupported proof.type: "${proof.type}". Expected "MERKLE_BATCH".`);
  if (!Number.isInteger(proof.batchId) || proof.batchId < 0) throw new Error("Invalid proof.batchId.");
  if (!Array.isArray(proof.proof)) throw new Error("proof.proof must be an array.");
  for (const sib of proof.proof) {
    if (!isBytes32Hex(sib)) throw new Error("proof.proof[] entries must be bytes32 hex.");
  }
  if (typeof proof.issuer !== "string" || !isAddress(proof.issuer)) throw new Error("proof.issuer must be a valid address.");

  return obj as DiplomaEnvelope;
}

export function normalizeAddress(a: Address): string {
  return a.toLowerCase();
}
