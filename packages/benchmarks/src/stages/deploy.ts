// packages/benchmarks/src/stages/deploy.ts
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { CHAIN_IDS, CHAIN_KEYS, RPC_ENV, type ChainKey } from "../config.js";

function deploymentPath(chainId: number): string {
  return path.resolve("contracts", "deployments", `${chainId}.json`);
}

function deployOne(key: ChainKey): void {
  const chainId = CHAIN_IDS[key];
  const p = deploymentPath(chainId);
  if (fs.existsSync(p)) {
    console.log(`[deploy] ${key} (${chainId}) — already deployed, skipping.`);
    return;
  }
  const rpcUrl = process.env[RPC_ENV[key]];
  const pk = process.env.BENCH_PK;
  if (!rpcUrl) throw new Error(`Missing ${RPC_ENV[key]}`);
  if (!pk) throw new Error(`Missing BENCH_PK`);

  console.log(`[deploy] ${key} (${chainId}) — broadcasting...`);
  execSync(
    `forge script script/Deploy.s.sol:Deploy --rpc-url ${rpcUrl} --private-key ${pk} --broadcast`,
    { cwd: path.resolve("contracts"), stdio: "inherit" }
  );
  if (!fs.existsSync(p)) {
    throw new Error(`[deploy] ${key}: Deploy.s.sol did not write ${p}`);
  }
  console.log(`[deploy] ${key} — OK (${p})`);
}

export async function stageDeploy(only?: ChainKey): Promise<void> {
  const keys = only ? [only] : CHAIN_KEYS;
  for (const key of keys) deployOne(key);
}
