// packages/benchmarks/tests/stages/export.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import tiny from "../fixtures/results/tiny-run.json";
import tinyPrices from "../fixtures/price-history/tiny-prices.json";
import { writeIssueCostTable } from "../../src/stages/export.js";
import { writeFigCostPerDiploma, writeFigGasVsL1Data } from "../../src/stages/export.js";
import { totalCostWei } from "../../src/cost-models/index.js";

describe("writeIssueCostTable", () => {
  it("emits CSV with one row per chain and one column per batch size", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const csvPath = writeIssueCostTable(tiny as never, tinyPrices as never, tmp);
      const csv = fs.readFileSync(csvPath, "utf8");
      expect(csv.split("\n")[0]).toContain("chain");
      expect(csv).toContain("sepolia");
      expect(csv).toContain("baseSepolia");
      // p50 of tinyPrices = 30 gwei → USD column present
      expect(csv).toMatch(/usd_p50/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("figure emission", () => {
  it("writes fig1 dat with one row per batch size", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const datPath = writeFigCostPerDiploma(tiny as never, tinyPrices as never, tmp);
      const lines = fs.readFileSync(datPath, "utf8").trim().split("\n");
      // header + 5 batch sizes
      expect(lines.length).toBe(6);
      expect(lines[0]).toMatch(/batchSize/);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("writes fig2 dat with one row per chain that has a 1000-size sample", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const datPath = writeFigGasVsL1Data(tiny as never, tmp);
      const content = fs.readFileSync(datPath, "utf8");
      // tiny-run has only size=1 and size=100 — fig2 is empty of data rows
      expect(content.trim().split("\n").length).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("writeIssueCostTable cost-model integration", () => {
  it("USD p50 column for baseSepolia matches the cost-model output", () => {
    const tmp = fs.mkdtempSync(path.join(process.cwd(), "tmp-export-"));
    try {
      const csvPath = writeIssueCostTable(tiny as never, tinyPrices as never, tmp);
      const csv = fs.readFileSync(csvPath, "utf8");
      const lines = csv.trim().split("\n");
      const header = lines[0].split(",");
      const baseRow = lines.find((l) => l.startsWith("baseSepolia"))!.split(",");
      const colName = "usd_p50_100";
      const idx = header.indexOf(colName);
      expect(idx).toBeGreaterThan(-1);

      // Recompute expected USD from cost-models + tiny prices p50 + ETH_USD = 3500
      const m100 = (tiny as never as { chains: Record<string, { issueBatch: never[] }> })
        .chains.baseSepolia.issueBatch.find((x: never) =>
          (x as { batchSize: number }).batchSize === 100
        ) as never;
      const normalized = {
        ...(m100 as object),
        gasUsed: BigInt((m100 as { gasUsed: string }).gasUsed),
        effectiveGasPrice: BigInt((m100 as { effectiveGasPrice: string }).effectiveGasPrice),
        l1DataFee: BigInt((m100 as { l1DataFee: string }).l1DataFee),
        l1GasUsed: BigInt((m100 as { l1GasUsed: string }).l1GasUsed),
        blockNumber: BigInt((m100 as { blockNumber: string }).blockNumber),
      };
      // p50 from tinyPrices = basefee 30 gwei, blob basefee 3 gwei
      const wei = totalCostWei(normalized as never, {
        basefeeWei: 30_000_000_000n,
        blobBasefeeWei: 3_000_000_000n,
      });
      const expectedUsd = (Number(wei) / 1e18) * 3500;
      const actualUsd = Number(baseRow[idx]);
      expect(actualUsd).toBeCloseTo(expectedUsd, 6);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
