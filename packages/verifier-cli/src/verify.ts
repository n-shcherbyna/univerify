import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { createPublicClient, http, isAddress, isHex, type Address, type Hex } from "viem";
import {
  DiplomaRegistryAbi,
  DiplomaPayloadSchema,
  formatZodError,
  hashPayload,
  type DiplomaPayload,
  type StatusCode,
} from "@univerify/verifier-core";

type MerkleBatchEnvelope = {
  payload: DiplomaPayload;
  proof: {
    type: "MERKLE_BATCH";
    issuer: Address;
    batchId: number;
    proof: Hex[];
  };
};

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

function readJsonFromFile(filePath: string): unknown {
  const abs = path.isAbsolute(filePath) ? filePath : path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(abs, "utf8");
  return JSON.parse(raw);
}

function parseArgs(): { input: unknown } {
  const args = process.argv.slice(2);
  const fileIdx = args.indexOf("--file");
  if (fileIdx !== -1) {
    const file = args[fileIdx + 1];
    if (!file) throw new Error("Missing value after --file.");
    return { input: readJsonFromFile(file) };
  }

  const jsonIdx = args.indexOf("--json");
  if (jsonIdx !== -1) {
    const raw = args[jsonIdx + 1];
    if (!raw) throw new Error("Missing value after --json.");
    return { input: JSON.parse(raw) };
  }

  throw new Error("Usage: verify -- --file diploma.json  OR  verify -- --json '<envelope_json>'");
}

function assertMerkleBatchEnvelope(v: unknown): MerkleBatchEnvelope {
  if (!v || typeof v !== "object") throw new Error("Envelope must be an object.");
  const env = v as any;
  if (!("payload" in env) || !("proof" in env)) throw new Error("Envelope must contain payload and proof.");
  if (!env.proof || typeof env.proof !== "object") throw new Error("Envelope.proof must be an object.");
  if (env.proof.type !== "MERKLE_BATCH") throw new Error("Only MERKLE_BATCH envelope is supported.");
  if (!isAddress(env.proof.issuer)) throw new Error("proof.issuer must be a valid address.");
  if (!Number.isInteger(env.proof.batchId) || env.proof.batchId < 0) throw new Error("proof.batchId must be uint64 integer.");
  if (!Array.isArray(env.proof.proof)) throw new Error("proof.proof must be a bytes32[] array.");
  if (env.proof.proof.length > 64) throw new Error("proof.proof is unreasonably large (max 64 nodes).");
  for (const p of env.proof.proof) {
    if (!isHex(p, { strict: true }) || String(p).length !== 66) {
      throw new Error("proof.proof entries must be bytes32 hex.");
    }
  }

  let payload: DiplomaPayload;
  try {
    payload = DiplomaPayloadSchema.parse(env.payload);
  } catch (e: unknown) {
    throw new Error(`Invalid diploma payload: ${formatZodError(e)}`);
  }

  return {
    payload,
    proof: {
      type: env.proof.type,
      issuer: env.proof.issuer,
      batchId: env.proof.batchId,
      proof: env.proof.proof,
    },
  };
}

async function main() {
  const RPC_URL = requireEnv("RPC_URL");
  const REGISTRY = requireEnv("REGISTRY_ADDRESS") as `0x${string}`;
  const { input } = parseArgs();
  const env = assertMerkleBatchEnvelope(input);

  const docHash = hashPayload(env.payload);
  const issuer = env.proof.issuer;
  const batchId = BigInt(env.proof.batchId);
  const proof = env.proof.proof;

  const client = createPublicClient({ transport: http(RPC_URL) });

  // statusWithProof checks Merkle proof validity AND that the issuer's
  // university is currently Active on-chain. University identity is always resolved
  // from the issuer address — never from payload fields.
  const code = (await client.readContract({
    address: REGISTRY,
    abi: DiplomaRegistryAbi,
    functionName: "statusWithProof",
    args: [docHash, issuer, batchId, proof],
  })) as StatusCode;

  const verified = code === 1;

  console.log(
    JSON.stringify(
      {
        docHash,
        issuer,
        batchId: batchId.toString(),
        student: `${env.payload.student.firstName} ${env.payload.student.lastName}`,
        diplomaNumber: env.payload.diplomaNumber,
        status: statusLabel(code),
        statusCode: code,
        verified,
      },
      null,
      2
    )
  );

  if (!verified) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
