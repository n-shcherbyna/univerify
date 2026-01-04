import "dotenv/config";
import fs from "node:fs";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { DiplomaRegistryAbi, hashPayload } from "@univerify/verifier-core";
import { sepolia } from "viem/chains";


function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

async function main() {
  const RPC_URL = requireEnv("RPC_URL");
  const REGISTRY = requireEnv("REGISTRY_ADDRESS") as `0x${string}`;
  const ISSUER_PK = requireEnv("ISSUER_PK");

  const payload = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
  const docHash = hashPayload(payload);

  const account = privateKeyToAccount(ISSUER_PK as `0x${string}`);

  const client = createWalletClient({
    account,
    chain: sepolia,
    transport: http(RPC_URL),
  });


  const txHash = await client.writeContract({
    address: REGISTRY,
    abi: DiplomaRegistryAbi,
    functionName: "issue",
    args: [docHash],
  });

  console.log("Issued diploma");
  console.log("docHash:", docHash);
  console.log("tx:", txHash);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
