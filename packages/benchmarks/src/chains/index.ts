import fs from "node:fs";
import path from "node:path";
import type { PrivateKeyAccount } from "viem/accounts";
import type { Address } from "viem";
import { CHAIN_IDS, RPC_ENV, type ChainKey } from "../config.js";
import type { ChainAdapter } from "./types.js";
import { createSepoliaAdapter } from "./sepolia.js";
import { createBaseSepoliaAdapter } from "./baseSepolia.js";
import { createArbitrumSepoliaAdapter } from "./arbitrumSepolia.js";
import { createZkSyncSepoliaAdapter } from "./zksyncSepolia.js";

function loadRegistryAddress(chainId: number): Address {
  const p = path.resolve("contracts", "deployments", `${chainId}.json`);
  if (!fs.existsSync(p)) {
    throw new Error(
      `Missing deployment file: ${p}. Run Stage 1 (deploy) for chainId=${chainId}.`
    );
  }
  const j = JSON.parse(fs.readFileSync(p, "utf8")) as { DiplomaRegistry?: string };
  if (!j.DiplomaRegistry) {
    throw new Error(`Malformed deployment file at ${p}: missing DiplomaRegistry.`);
  }
  return j.DiplomaRegistry as Address;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set; see packages/benchmarks/README.md`);
  return v;
}

export function getAdapter(key: ChainKey, account: PrivateKeyAccount): ChainAdapter {
  const chainId = CHAIN_IDS[key];
  const rpcUrl = requireEnv(RPC_ENV[key]);
  const registryAddress = loadRegistryAddress(chainId);
  switch (key) {
    case "sepolia":
      return createSepoliaAdapter({ rpcUrl, registryAddress, account });
    case "baseSepolia":
      return createBaseSepoliaAdapter({ rpcUrl, registryAddress, account });
    case "arbitrumSepolia":
      return createArbitrumSepoliaAdapter({ rpcUrl, registryAddress, account });
    case "zksyncSepolia":
      return createZkSyncSepoliaAdapter({ rpcUrl, registryAddress, account });
  }
}
