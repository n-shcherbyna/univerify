// packages/benchmarks/src/stages/export.ts
import fs from "node:fs";
import path from "node:path";
import type { NormalizedMetrics, ReadLatencySample } from "../chains/types.js";
import { BATCH_SIZES } from "../config.js";
import { derivePercentiles, type PriceHistory } from "./price.js";

// --- result envelope written by Stage 2 -----------------------------------
export type PerChainResults = {
  issueBatch: NormalizedMetrics[];
  revokeFromBatch: NormalizedMetrics[];
  readLatency: ReadLatencySample[];
};
export type RunResults = {
  runId: string;
  measuredAt: string;
  chains: Record<string, PerChainResults>;
};

// --- Cost model -----------------------------------------------------------
/** ETH price in USD used for USD-cost columns. Sourced separately; hard-coded for now. */
export const ETH_USD = 3500;

function totalCostWei(m: NormalizedMetrics, basefeeWei: bigint): bigint {
  // gasUsed × basefee (modelled L1 price) + l1DataFee (already in wei, measured).
  // Coerce through BigInt so JSON-loaded fixtures (string numerics) also work.
  return BigInt(m.gasUsed) * basefeeWei + BigInt(m.l1DataFee);
}

function weiToUsd(wei: bigint): number {
  const eth = Number(wei) / 1e18;
  return eth * ETH_USD;
}

// --- Tables ---------------------------------------------------------------
export function writeIssueCostTable(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p10, p50, p90 } = derivePercentiles(prices);
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, "table-issue-cost.csv");

  const sizeCols = [...BATCH_SIZES];
  const header = [
    "chain",
    ...sizeCols.map((s) => `gas_${s}`),
    ...sizeCols.map((s) => `l1data_wei_${s}`),
    ...sizeCols.map((s) => `usd_p10_${s}`),
    ...sizeCols.map((s) => `usd_p50_${s}`),
    ...sizeCols.map((s) => `usd_p90_${s}`),
  ].join(",");

  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    const byBatch = new Map<number, NormalizedMetrics>();
    for (const m of data.issueBatch) {
      if (m.tag !== "main" || m.batchSize == null) continue;
      byBatch.set(m.batchSize, m);
    }
    const gas = sizeCols.map((s) => BigInt(byBatch.get(s)?.gasUsed ?? 0n).toString());
    const l1 = sizeCols.map((s) => BigInt(byBatch.get(s)?.l1DataFee ?? 0n).toString());
    const u10 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, p10)).toFixed(6) : "";
    });
    const u50 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, p50)).toFixed(6) : "";
    });
    const u90 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, p90)).toFixed(6) : "";
    });
    rows.push([chain, ...gas, ...l1, ...u10, ...u50, ...u90].join(","));
  }

  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeIssuePerDiplomaTable(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p50 } = derivePercentiles(prices);
  const csvPath = path.join(outDir, "table-issue-per-diploma.csv");
  const sizeCols = [...BATCH_SIZES];
  const header = ["chain", ...sizeCols.map((s) => `usd_p50_per_diploma_${s}`)].join(",");
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    const byBatch = new Map<number, NormalizedMetrics>();
    for (const m of data.issueBatch) {
      if (m.tag !== "main" || m.batchSize == null) continue;
      byBatch.set(m.batchSize, m);
    }
    const values = sizeCols.map((s) => {
      const m = byBatch.get(s);
      if (!m || m.batchSize == null) return "";
      return (weiToUsd(totalCostWei(m, p50)) / m.batchSize).toFixed(9);
    });
    rows.push([chain, ...values].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeRevokeCostTable(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { p50 } = derivePercentiles(prices);
  const csvPath = path.join(outDir, "table-revoke-cost.csv");
  const header = "chain,median_gas,median_l1data_wei,usd_p50";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.revokeFromBatch.length === 0) continue;
    const sorted = [...data.revokeFromBatch].sort((a, b) =>
      a.gasUsed < b.gasUsed ? -1 : a.gasUsed > b.gasUsed ? 1 : 0
    );
    const mid = sorted[Math.floor(sorted.length / 2)];
    const usd = weiToUsd(totalCostWei(mid, p50));
    rows.push([chain, mid.gasUsed, mid.l1DataFee, usd.toFixed(6)].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeReadLatencyTable(run: RunResults, outDir: string): string {
  const csvPath = path.join(outDir, "table-read-latency.csv");
  const header = "chain,p50_ms,p95_ms,p99_ms,max_ms";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.readLatency.length === 0) continue;
    const s = data.readLatency.map((x) => x.latencyMs).sort((a, b) => a - b);
    const pick = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    rows.push([chain, pick(0.5), pick(0.95), pick(0.99), s[s.length - 1]].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeInclusionLatencyTable(run: RunResults, outDir: string): string {
  const csvPath = path.join(outDir, "table-inclusion-latency.csv");
  const header = "chain,p50_ms,p95_ms";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.revokeFromBatch.length === 0) continue;
    const s = data.revokeFromBatch.map((x) => x.inclusionLatencyMs).sort((a, b) => a - b);
    const pick = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    rows.push([chain, pick(0.5), pick(0.95)].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}
