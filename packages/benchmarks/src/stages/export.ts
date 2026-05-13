// packages/benchmarks/src/stages/export.ts
import fs from "node:fs";
import path from "node:path";
import type { NormalizedMetrics, ReadLatencySample } from "../chains/types.js";
import { BATCH_SIZES } from "../config.js";
import {
  getCostModel,
  totalCostWei,
  type PriceQuote,
} from "../cost-models/index.js";
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
/**
 * ETH price in USD used for the USD-cost columns. Defaults to the
 * 2026-05-13 snapshot ($3500, CoinGecko ETH/USD spot, mid-day UTC). For
 * a fresh export at a different snapshot, set the `ETH_USD_SNAPSHOT`
 * env var. The chosen value is also recorded in `meta.json` so every
 * data file is traceable to the price assumption that produced it.
 */
export const ETH_USD_SNAPSHOT_DATE = "2026-05-13";
export const ETH_USD = Number(process.env.ETH_USD_SNAPSHOT ?? 3500);

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
  const { basefee, blobBasefee } = derivePercentiles(prices);
  const q10: PriceQuote = { basefeeWei: basefee.p10, blobBasefeeWei: blobBasefee.p10 };
  const q50: PriceQuote = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
  const q90: PriceQuote = { basefeeWei: basefee.p90, blobBasefeeWei: blobBasefee.p90 };
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
      return m ? weiToUsd(totalCostWei(m, q10)).toFixed(6) : "";
    });
    const u50 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, q50)).toFixed(6) : "";
    });
    const u90 = sizeCols.map((s) => {
      const m = byBatch.get(s);
      return m ? weiToUsd(totalCostWei(m, q90)).toFixed(6) : "";
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
  const { basefee, blobBasefee } = derivePercentiles(prices);
  const q50: PriceQuote = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
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
      return (weiToUsd(totalCostWei(m, q50)) / m.batchSize).toFixed(9);
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
  const { basefee, blobBasefee } = derivePercentiles(prices);
  const q50: PriceQuote = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
  const csvPath = path.join(outDir, "table-revoke-cost.csv");
  const header = "chain,median_gas,median_l1data_wei,usd_p50";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.revokeFromBatch.length === 0) continue;
    const sorted = [...data.revokeFromBatch].sort((a, b) =>
      a.gasUsed < b.gasUsed ? -1 : a.gasUsed > b.gasUsed ? 1 : 0
    );
    const mid = sorted[Math.floor(sorted.length / 2)];
    const usd = weiToUsd(totalCostWei(mid, q50));
    rows.push([chain, mid.gasUsed, mid.l1DataFee, usd.toFixed(6)].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

export function writeReadLatencyTable(run: RunResults, outDir: string): string {
  // At N=100 samples per chain, p99 is a single-sample estimate equal to the
  // max — reporting it adds no information beyond max_observed_ms, so omit.
  const csvPath = path.join(outDir, "table-read-latency.csv");
  const header = "chain,p50_ms,p95_ms,max_observed_ms";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    if (data.readLatency.length === 0) continue;
    const s = data.readLatency.map((x) => x.latencyMs).sort((a, b) => a - b);
    const pick = (p: number) =>
      s[Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length) - 1))];
    rows.push([chain, pick(0.5), pick(0.95), s[s.length - 1]].join(","));
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
    const pick = (p: number) =>
      s[Math.max(0, Math.min(s.length - 1, Math.ceil(p * s.length) - 1))];
    rows.push([chain, pick(0.5), pick(0.95)].join(","));
  }
  fs.writeFileSync(csvPath, [header, ...rows].join("\n") + "\n");
  return csvPath;
}

// --- Figures --------------------------------------------------------------

export function writeFigCostPerDiploma(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { basefee, blobBasefee } = derivePercentiles(prices);
  const q50: PriceQuote = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
  const datPath = path.join(outDir, "fig1-cost-per-diploma.dat");
  const sizeCols = [...BATCH_SIZES];
  const header = ["batchSize", ...Object.keys(run.chains)].join(" ");
  const rows: string[] = [];
  for (const s of sizeCols) {
    const cols: string[] = [String(s)];
    for (const chain of Object.keys(run.chains)) {
      const m = run.chains[chain].issueBatch.find(
        (x) => x.tag === "main" && x.batchSize === s
      );
      cols.push(m ? (weiToUsd(totalCostWei(m, q50)) / s).toFixed(12) : "nan");
    }
    rows.push(cols.join(" "));
  }
  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

export function writeFigGasVsL1Data(
  run: RunResults,
  outDir: string,
  prices?: PriceHistory
): string {
  const datPath = path.join(outDir, "fig2-gas-vs-l1data.dat");
  const header = "chain execution_wei l1data_wei";
  const rows: string[] = [];

  let q50: PriceQuote | null = null;
  if (prices) {
    const { basefee, blobBasefee } = derivePercentiles(prices);
    q50 = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
  }

  for (const [chain, data] of Object.entries(run.chains)) {
    const m = data.issueBatch.find((x) => x.tag === "main" && x.batchSize === 1000);
    if (!m) continue;
    const model = getCostModel(m.chainName);
    // When prices are absent (test path), fall back to measured testnet values
    // so the existing structural test on the empty fixture still works.
    const q = q50 ?? { basefeeWei: BigInt(m.effectiveGasPrice), blobBasefeeWei: 0n };
    const exec = model.exec(m, q);
    const l1Wei = q50 != null ? model.l1Data(m, q) : BigInt(m.l1DataFee);
    rows.push([chain, exec.toString(), l1Wei.toString()].join(" "));
  }

  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

export function writeFigReadLatencyCdf(run: RunResults, outDir: string): string {
  const datPath = path.join(outDir, "fig3-read-latency-cdf.dat");
  const chains = Object.keys(run.chains);
  const series = chains.map((c) =>
    run.chains[c].readLatency.map((x) => x.latencyMs).sort((a, b) => a - b)
  );
  const maxLen = Math.max(0, ...series.map((s) => s.length));
  const header = ["rank", ...chains].join(" ");
  const rows: string[] = [];
  for (let i = 0; i < maxLen; i++) {
    const cols: string[] = [String(i + 1)];
    for (const s of series) cols.push(i < s.length ? s[i].toFixed(2) : "nan");
    rows.push(cols.join(" "));
  }
  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

export function writeFigBasefeeScenarios(
  run: RunResults,
  prices: PriceHistory,
  outDir: string
): string {
  const { basefee, blobBasefee } = derivePercentiles(prices);
  const q10: PriceQuote = { basefeeWei: basefee.p10, blobBasefeeWei: blobBasefee.p10 };
  const q50: PriceQuote = { basefeeWei: basefee.p50, blobBasefeeWei: blobBasefee.p50 };
  const q90: PriceQuote = { basefeeWei: basefee.p90, blobBasefeeWei: blobBasefee.p90 };
  const datPath = path.join(outDir, "fig4-basefee-scenarios.dat");
  const header = "chain quiet_usd normal_usd congested_usd";
  const rows: string[] = [];
  for (const [chain, data] of Object.entries(run.chains)) {
    const m = data.issueBatch.find((x) => x.tag === "main" && x.batchSize === 1000);
    if (!m) continue;
    rows.push(
      [
        chain,
        weiToUsd(totalCostWei(m, q10)).toFixed(6),
        weiToUsd(totalCostWei(m, q50)).toFixed(6),
        weiToUsd(totalCostWei(m, q90)).toFixed(6),
      ].join(" ")
    );
  }
  fs.writeFileSync(datPath, [header, ...rows].join("\n") + "\n");
  return datPath;
}

export function writeMeta(
  run: RunResults,
  pricePath: string,
  outDir: string
): string {
  const outPath = path.join(outDir, "meta.json");
  const meta = {
    runId: run.runId,
    measuredAt: run.measuredAt,
    priceSource: pricePath,
    ethUsd: ETH_USD,
    ethUsdSnapshotDate: ETH_USD_SNAPSHOT_DATE,
    chains: Object.keys(run.chains),
  };
  fs.writeFileSync(outPath, JSON.stringify(meta, null, 2));
  return outPath;
}

export function writeMeasuredAt(run: RunResults, outDir: string): string {
  const p = path.join(outDir, "measured-at.tex");
  fs.writeFileSync(p, run.measuredAt);
  return p;
}

// --- Stage driver ---------------------------------------------------------

export type StageExportOpts = { resultsPath?: string; pricesPath?: string };

export function stageExport(opts: StageExportOpts = {}): void {
  const resultsPath = opts.resultsPath ?? newestResultsPath();
  if (!resultsPath) throw new Error("no results file in benchmarks/results/");
  const pricesPath = opts.pricesPath ?? newestPriceHistoryPathLocal();
  if (!pricesPath)
    throw new Error(
      "no price history in benchmarks/price-history/ — run `benchmarks price` first"
    );
  const run = JSON.parse(fs.readFileSync(resultsPath, "utf8")) as RunResults;
  const prices = JSON.parse(fs.readFileSync(pricesPath, "utf8")) as PriceHistory;
  const outDir = path.resolve("docs", "l2-benchmarks", "data");
  writeIssueCostTable(run, prices, outDir);
  writeIssuePerDiplomaTable(run, prices, outDir);
  writeRevokeCostTable(run, prices, outDir);
  writeReadLatencyTable(run, outDir);
  writeInclusionLatencyTable(run, outDir);
  writeFigCostPerDiploma(run, prices, outDir);
  writeFigGasVsL1Data(run, outDir, prices);
  writeFigReadLatencyCdf(run, outDir);
  writeFigBasefeeScenarios(run, prices, outDir);
  writeMeta(run, pricesPath, outDir);
  writeMeasuredAt(run, outDir);
  console.log(`[export] wrote 11 files under ${outDir}`);
}

function newestResultsPath(): string | null {
  const dir = path.resolve("benchmarks", "results");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json") && !f.endsWith(".partial.json"))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}

function newestPriceHistoryPathLocal(): string | null {
  const dir = path.resolve("benchmarks", "price-history");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}
