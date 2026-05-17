// packages/benchmarks/src/stages/measureResume.ts
import type { ChainKey } from "../config.js";

export type OpKind = "issueBatch" | "revokeBurst" | "readLatency";

export type ResumeProgress = Partial<
  Record<
    ChainKey,
    {
      issueBatch?: Record<number, "complete">;
      revokeBurst?: "complete";
      readLatency?: "complete";
    }
  >
>;

export function resumeNeedsOp(
  prog: ResumeProgress,
  chain: ChainKey,
  op: OpKind,
  size?: number
): boolean {
  const c = prog[chain];
  if (!c) return true;
  if (op === "issueBatch") {
    if (size === undefined) throw new Error("issueBatch requires size");
    return c.issueBatch?.[size] !== "complete";
  }
  return c[op] !== "complete";
}

export function markComplete(
  prog: ResumeProgress,
  chain: ChainKey,
  op: OpKind,
  size?: number
): void {
  const c = (prog[chain] ??= {});
  if (op === "issueBatch") {
    if (size === undefined) throw new Error("issueBatch requires size");
    (c.issueBatch ??= {})[size] = "complete";
  } else {
    (c as any)[op] = "complete";
  }
}
