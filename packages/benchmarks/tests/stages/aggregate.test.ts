import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { aggregateRuns } from "../../src/stages/aggregate.js";

function writeRun(dir: string, label: string, chains: any): string {
  const sub = path.join(dir, label);
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, "test.json");
  fs.writeFileSync(
    file,
    JSON.stringify({ runId: label, measuredAt: "2026-01-01", chains }, null, 2)
  );
  return file;
}

describe("aggregateRuns", () => {
  it("merges issueBatch latencySamplesMs across runs by (chain, batchSize)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-"));
    writeRun(dir, "run-1", {
      sepolia: {
        issueBatch: [
          { chainName: "sepolia", tag: "main", batchSize: 1000, gasUsed: "100", effectiveGasPrice: "0", l1DataFee: "0", inclusionLatencyMs: 900, latencySamplesMs: [900, 950] },
        ],
        revokeFromBatch: [],
        readLatency: [],
      },
    });
    writeRun(dir, "run-2", {
      sepolia: {
        issueBatch: [
          { chainName: "sepolia", tag: "main", batchSize: 1000, gasUsed: "100", effectiveGasPrice: "0", l1DataFee: "0", inclusionLatencyMs: 1100, latencySamplesMs: [1050, 1100] },
        ],
        revokeFromBatch: [],
        readLatency: [],
      },
    });
    const merged = aggregateRuns([
      path.join(dir, "run-1", "test.json"),
      path.join(dir, "run-2", "test.json"),
    ]);
    const m = merged.chains.sepolia.issueBatch.find(
      (x: any) => x.batchSize === 1000 && x.tag === "main"
    );
    expect(m.latencySamplesMs).toEqual([900, 950, 1050, 1100]);
  });

  it("concatenates revokeFromBatch and readLatency arrays", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agg-"));
    writeRun(dir, "run-1", {
      sepolia: {
        issueBatch: [],
        revokeFromBatch: [{ inclusionLatencyMs: 100 }],
        readLatency: [{ latencyMs: 50 }],
      },
    });
    writeRun(dir, "run-2", {
      sepolia: {
        issueBatch: [],
        revokeFromBatch: [{ inclusionLatencyMs: 200 }],
        readLatency: [{ latencyMs: 60 }],
      },
    });
    const merged = aggregateRuns([
      path.join(dir, "run-1", "test.json"),
      path.join(dir, "run-2", "test.json"),
    ]);
    expect(merged.chains.sepolia.revokeFromBatch).toHaveLength(2);
    expect(merged.chains.sepolia.readLatency).toHaveLength(2);
  });
});
