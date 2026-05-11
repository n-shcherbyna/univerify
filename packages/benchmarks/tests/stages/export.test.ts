// packages/benchmarks/tests/stages/export.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import tiny from "../fixtures/results/tiny-run.json";
import tinyPrices from "../fixtures/price-history/tiny-prices.json";
import { writeIssueCostTable } from "../../src/stages/export.js";
import { writeFigCostPerDiploma, writeFigGasVsL1Data } from "../../src/stages/export.js";

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
