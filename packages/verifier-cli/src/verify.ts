import fs from "node:fs";
import path from "node:path";
import { canonicalize } from "json-canonicalize";
import { createPublicClient, http, keccak256, toBytes } from "viem";
import { hashPayload, DiplomaRegistryAbi, StatusCode } from "@univerify/verifier-core";


function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function statusLabel(code: StatusCode): "Unknown" | "Valid" | "Revoked" {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

function readPayloadFromFile(filePath: string): unknown {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function parseArgs(): { payload: unknown } {
  // Usage:
  //   npm run verify -- --file payload.json
  //   npm run verify -- '<json>'
  const args = process.argv.slice(2);

  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1) {
    const file = args[fileIdx + 1];
    if (!file) throw new Error("Missing value after --file (e.g. --file payload.json)");
    return { payload: readPayloadFromFile(file) };
  }

  const arg = args[0];
  if (!arg) throw new Error('Usage: verify -- --file payload.json  OR  verify \'<payload_json>\'');
  return { payload: JSON.parse(arg) };
}

async function main() {
  const RPC_URL = requireEnv("RPC_URL");
  const REGISTRY = requireEnv("REGISTRY_ADDRESS") as `0x${string}`;

  const { payload } = parseArgs();

  const canonical = canonicalize(payload);
  const docHash = keccak256(toBytes(canonical));

  const client = createPublicClient({ transport: http(RPC_URL) });

  const code = (await client.readContract({
    address: REGISTRY,
    abi: DiplomaRegistryAbi,
    functionName: "status",
    args: [docHash],
  })) as StatusCode;

  console.log(
    JSON.stringify(
      { docHash, status: statusLabel(code), statusCode: code },
      null,
      2
    )
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
