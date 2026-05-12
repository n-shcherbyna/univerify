// packages/benchmarks/src/stages/price.ts
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

export type PriceSample = { blockNumber: number; baseFeePerGas: string };
export type PriceHistory = {
  source: string;
  fetchedAt: string;
  windowDays: number;
  samples: PriceSample[];
};

export type Percentiles = { p10: bigint; p50: bigint; p90: bigint };

export function derivePercentiles(h: PriceHistory): Percentiles {
  const bigs = h.samples
    .map((s) => BigInt(s.baseFeePerGas))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // Nearest-rank, zero-indexed: index = ceil(p * n) - 1, clamped to [0, n-1].
  const pick = (p: number) =>
    bigs[Math.max(0, Math.min(bigs.length - 1, Math.ceil(p * bigs.length) - 1))];
  return { p10: pick(0.1), p50: pick(0.5), p90: pick(0.9) };
}

const BLOCKS_PER_DAY = 7200; // mainnet, ~12s blocks
const WINDOW_DAYS = 90;
const SAMPLE_STRIDE = BLOCKS_PER_DAY; // one sample per day

async function fetchBasefeeHistory(rpcUrl: string): Promise<PriceHistory> {
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  const latest = await client.getBlockNumber();
  const samples: PriceSample[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const bn = latest - BigInt(i) * BigInt(SAMPLE_STRIDE);
    if (bn <= 0n) break;
    const block = await client.getBlock({ blockNumber: bn });
    if (block.baseFeePerGas == null) continue;
    samples.push({ blockNumber: Number(bn), baseFeePerGas: block.baseFeePerGas.toString() });
  }
  return {
    source: "eth_getBlockByNumber",
    fetchedAt: new Date().toISOString(),
    windowDays: WINDOW_DAYS,
    samples,
  };
}

export async function stagePrice(): Promise<string> {
  const outDir = path.resolve("benchmarks", "price-history");
  fs.mkdirSync(outDir, { recursive: true });
  const today = new Date().toISOString().slice(0, 10);
  const outPath = path.join(outDir, `${today}.json`);
  if (fs.existsSync(outPath)) {
    console.log(`[price] ${outPath} already exists — reusing.`);
    return outPath;
  }
  const rpcUrl = process.env.RPC_MAINNET;
  if (!rpcUrl) throw new Error("RPC_MAINNET is not set (public RPC is fine).");
  console.log(`[price] fetching 90-day basefee history from ${rpcUrl}...`);
  const hist = await fetchBasefeeHistory(rpcUrl);
  fs.writeFileSync(outPath, JSON.stringify(hist, null, 2));
  console.log(`[price] wrote ${outPath} (${hist.samples.length} samples)`);
  return outPath;
}

export function readPriceHistory(p: string): PriceHistory {
  return JSON.parse(fs.readFileSync(p, "utf8")) as PriceHistory;
}

export function newestPriceHistoryPath(): string | null {
  const dir = path.resolve("benchmarks", "price-history");
  if (!fs.existsSync(dir)) return null;
  const files = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .reverse();
  return files.length ? path.join(dir, files[0]) : null;
}
