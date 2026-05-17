// packages/benchmarks/src/util/atomicWrite.ts
import fs from "node:fs";

/**
 * Write JSON atomically: serialize → write to `${target}.tmp` → rename to
 * `target`. A SIGINT or crash mid-write cannot leave `target` in a partially
 * written state because `rename` is atomic on POSIX. If serialization throws,
 * the target is left untouched.
 */
export function atomicWriteJson(target: string, obj: unknown): void {
  const payload = JSON.stringify(
    obj,
    (_, v) => (typeof v === "bigint" ? v.toString() : v),
    2
  );
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, payload);
  fs.renameSync(tmp, target);
}
