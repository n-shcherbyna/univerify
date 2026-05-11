// packages/benchmarks/tests/stages/export.test.ts
import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import tiny from "../fixtures/results/tiny-run.json";
import tinyPrices from "../fixtures/price-history/tiny-prices.json";
import { writeIssueCostTable } from "../../src/stages/export.js";

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
