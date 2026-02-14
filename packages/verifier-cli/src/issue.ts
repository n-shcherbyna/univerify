import "dotenv/config";
import { createWalletClient, http, isHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { DiplomaRegistryAbi } from "@univerify/verifier-core";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function parseArgs(): { batchId: bigint; merkleRoot: Hex } {
  const args = process.argv.slice(2);
  const batchIdIdx = args.indexOf("--batch-id");
  const rootIdx = args.indexOf("--root");

  if (batchIdIdx === -1 || rootIdx === -1) {
    throw new Error('Usage: issue -- --batch-id <uint64> --root <0xbytes32>');
  }

  const batchIdRaw = args[batchIdIdx + 1];
  const rootRaw = args[rootIdx + 1];
  if (!batchIdRaw || !/^\d+$/.test(batchIdRaw)) {
    throw new Error("Invalid --batch-id (expected non-negative integer).");
  }
  if (!rootRaw || !isHex(rootRaw, { strict: true }) || rootRaw.length !== 66) {
    throw new Error("Invalid --root (expected bytes32 hex).");
  }

  const batchId = BigInt(batchIdRaw);
  if (batchId > (1n << 64n) - 1n) throw new Error("--batch-id exceeds uint64.");
  return { batchId, merkleRoot: rootRaw as Hex };
}

async function main() {
  const RPC_URL = requireEnv("RPC_URL");
  const REGISTRY = requireEnv("REGISTRY_ADDRESS") as `0x${string}`;
  const ISSUER_PK = requireEnv("ISSUER_PK");
  const { batchId, merkleRoot } = parseArgs();

  const account = privateKeyToAccount(ISSUER_PK as `0x${string}`);
  const client = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  });

  const txHash = await client.writeContract({
    address: REGISTRY,
    abi: DiplomaRegistryAbi,
    functionName: "issueBatchRoot",
    args: [batchId, merkleRoot],
  });

  console.log("Batch root published");
  console.log("issuer:", account.address);
  console.log("batchId:", batchId.toString());
  console.log("merkleRoot:", merkleRoot);
  console.log("tx:", txHash);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

