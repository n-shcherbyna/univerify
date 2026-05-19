// packages/benchmarks/src/stages/aggregate.ts
import fs from "node:fs";
import path from "node:path";
import type { NormalizedMetrics } from "../chains/types.js";
import { atomicWriteJson } from "../util/atomicWrite.js";
import type { PerChainResults, RunResults } from "./export.js";

/**
 * Combine N independent runs into a single `RunResults`:
 *   - `issueBatch[tag=main, size=S]` entries are merged by (chain, size). `latencySamplesMs`
 *     arrays are concatenated. Gas/exec metrics (gasUsed, effectiveGasPrice, l1DataFee, etc.)
 *     are taken from the first run because gas is deterministic given inputs.
 *   - `issueBatch[tag=seed]` entries are concatenated (one per run, distinct seed batches).
 *   - `revokeFromBatch` and `readLatency` arrays are concatenated across all runs.
 */
export function aggregateRuns(runPaths: string[]): RunResults {
  if (runPaths.length === 0) throw new Error("aggregateRuns: no runs given");
  const runs = runPaths.map((p) => JSON.parse(fs.readFileSync(p, "utf8")) as RunResults);

  const merged: RunResults = {
    runId: `agg-${runs.map((r) => r.runId).join("+")}`,
    measuredAt: runs[0].measuredAt,
    chains: {},
  };

  const chainNames = new Set<string>();
  for (const r of runs) for (const c of Object.keys(r.chains)) chainNames.add(c);

  for (const chain of chainNames) {
    const out: PerChainResults = {
      issueBatch: [],
      revokeFromBatch: [],
      readLatency: [],
    };

    // Merge main issueBatch entries by batchSize, concatenating latency samples.
    const mainBySize = new Map<number, NormalizedMetrics>();
    for (const r of runs) {
      const c = r.chains[chain];
      if (!c) continue;
      for (const m of c.issueBatch) {
        if (m.tag !== "main" || m.batchSize == null) continue;
        const existing = mainBySize.get(m.batchSize);
        if (!existing) {
          mainBySize.set(m.batchSize, {
            ...m,
            latencySamplesMs: [...(m.latencySamplesMs ?? [m.inclusionLatencyMs])],
          });
        } else {
          existing.latencySamplesMs = [
            ...(existing.latencySamplesMs ?? []),
            ...(m.latencySamplesMs ?? [m.inclusionLatencyMs]),
          ];
        }
      }
    }
    out.issueBatch.push(...mainBySize.values());

    // Preserve seed batches (one per run, deduped by run order).
    for (const r of runs) {
      const c = r.chains[chain];
      if (!c) continue;
      for (const m of c.issueBatch) {
        if (m.tag === "seed") out.issueBatch.push(m);
      }
    }

    // Concatenate revokeFromBatch and readLatency across runs.
    for (const r of runs) {
      const c = r.chains[chain];
      if (!c) continue;
      out.revokeFromBatch.push(...c.revokeFromBatch);
      out.readLatency.push(...c.readLatency);
    }

    merged.chains[chain] = out;
  }

  return merged;
}

export function stageAggregate(opts: { runsDir?: string } = {}): string {
  const dir = opts.runsDir ?? path.resolve("benchmarks", "results");
  const runDirs = fs
    .readdirSync(dir)
    .filter((f) => fs.statSync(path.join(dir, f)).isDirectory() && f.startsWith("run-"))
    .sort();
  if (runDirs.length === 0) {
    throw new Error(`no run-* subdirectories in ${dir}`);
  }
  const runPaths: string[] = [];
  for (const sub of runDirs) {
    const subPath = path.join(dir, sub);
    const file = fs
      .readdirSync(subPath)
      .filter((f) => f.endsWith(".json") && !f.endsWith(".partial.json"))
      .sort()
      .reverse()[0];
    if (file) runPaths.push(path.join(subPath, file));
  }
  const merged = aggregateRuns(runPaths);
  const outPath = path.join(dir, `aggregated-${Date.now()}.json`);
  atomicWriteJson(outPath, merged);
  // Sibling metadata file recording run count and source paths.
  const metaPath = outPath.replace(/\.json$/, ".aggregate-meta.json");
  fs.writeFileSync(
    metaPath,
    JSON.stringify({ runs: runPaths.length, sources: runPaths }, null, 2)
  );
  console.log(`[aggregate] merged ${runPaths.length} runs → ${outPath}`);
  return outPath;
}
