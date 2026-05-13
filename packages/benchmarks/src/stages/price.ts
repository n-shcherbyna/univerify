// packages/benchmarks/src/stages/price.ts
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http } from "viem";
import { mainnet } from "viem/chains";

/**
 * EIP-4844 reference exponential approximation.
 * Returns: factor * e^(numerator / denominator) — implemented as an integer
 * Taylor series, matching the consensus-spec reference function used by
 * execution clients to derive blob basefee from excessBlobGas.
 *
 * Source: EIP-4844, "fake_exponential" pseudocode.
 *
 * NOTE: Not used in production — `fetchBasefeeHistory` now calls
 * `eth_feeHistory` to read `baseFeePerBlobGas` directly from the node,
 * which is resilient to post-Cancun fork changes to BLOB_BASE_FEE_UPDATE_FRACTION
 * (Pectra raised it; later BPO forks adjust it further). Kept exported so the
 * spec reference function remains available and testable.
 */
export function fakeExponential(
  factor: bigint,
  numerator: bigint,
  denominator: bigint
): bigint {
  let i = 1n;
  let output = 0n;
  let numeratorAccum = factor * denominator;
  while (numeratorAccum > 0n) {
    output += numeratorAccum;
    numeratorAccum = (numeratorAccum * numerator) / (denominator * i);
    i += 1n;
  }
  return output / denominator;
}

export type PriceSample = {
  blockNumber: number;
  baseFeePerGas: string;
  blobBaseFeePerGas: string;
};
export type PriceHistory = {
  source: string;
  fetchedAt: string;
  windowDays: number;
  samples: PriceSample[];
};

export type Percentiles = { p10: bigint; p50: bigint; p90: bigint };
export type PriceQuotePercentiles = {
  basefee: Percentiles;
  blobBasefee: Percentiles;
};

export function derivePercentiles(h: PriceHistory): PriceQuotePercentiles {
  if (h.samples.length === 0) {
    throw new Error("derivePercentiles: empty price history");
  }
  if (h.samples[0].blobBaseFeePerGas == null) {
    throw new Error(
      "derivePercentiles: price-history file predates blob basefee support. " +
        "Re-run `benchmarks price` to fetch a fresh window with blob basefees."
    );
  }
  const pickWei = (selector: (s: PriceSample) => string): Percentiles => {
    const bigs = h.samples
      .map((s) => BigInt(selector(s)))
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const pick = (p: number) =>
      bigs[Math.max(0, Math.min(bigs.length - 1, Math.ceil(p * bigs.length) - 1))];
    return { p10: pick(0.1), p50: pick(0.5), p90: pick(0.9) };
  };
  return {
    basefee: pickWei((s) => s.baseFeePerGas),
    blobBasefee: pickWei((s) => s.blobBaseFeePerGas),
  };
}

const BLOCKS_PER_DAY = 7200; // mainnet, ~12s blocks
const WINDOW_DAYS = 90;
const SAMPLE_STRIDE = BLOCKS_PER_DAY; // one sample per day

type FeeHistoryResponse = {
  baseFeePerGas: `0x${string}`[];
  baseFeePerBlobGas?: `0x${string}`[];
};

async function fetchBasefeeHistory(rpcUrl: string): Promise<PriceHistory> {
  const client = createPublicClient({ chain: mainnet, transport: http(rpcUrl) });
  const latest = await client.getBlockNumber();
  const samples: PriceSample[] = [];
  for (let i = 0; i < WINDOW_DAYS; i++) {
    const bn = latest - BigInt(i) * BigInt(SAMPLE_STRIDE);
    if (bn <= 0n) break;
    // eth_feeHistory(blockCount=1, newestBlock=bn) returns [bn, bn+1] for both
    // baseFeePerGas and baseFeePerBlobGas — we take index 0 (the sampled block).
    // Using the node's computed value avoids hardcoding fork-dependent
    // BLOB_BASE_FEE_UPDATE_FRACTION (Pectra and later BPO forks change it).
    const fh = (await client.request({
      method: "eth_feeHistory",
      params: [`0x1`, `0x${bn.toString(16)}`, []],
    } as never)) as FeeHistoryResponse;
    if (!fh.baseFeePerBlobGas || fh.baseFeePerBlobGas.length === 0) {
      throw new Error(
        `Block ${bn} predates Cancun (eth_feeHistory returned no baseFeePerBlobGas). ` +
          `The 90-day window must lie entirely post-Cancun; re-run after the next sync.`
      );
    }
    samples.push({
      blockNumber: Number(bn),
      baseFeePerGas: BigInt(fh.baseFeePerGas[0]).toString(),
      blobBaseFeePerGas: BigInt(fh.baseFeePerBlobGas[0]).toString(),
    });
  }
  return {
    source: "eth_feeHistory",
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
