import fs from "node:fs";
import path from "node:path";

function getEnv(name, fallback = "") {
  return process.env[name] ?? fallback;
}

const chainId = getEnv("CHAIN_ID", "11155111"); // domyślnie Sepolia
const deploymentsPath = path.resolve("contracts", "deployments", `${chainId}.json`);

if (!fs.existsSync(deploymentsPath)) {
  throw new Error(`Missing deployments file: ${deploymentsPath}. Deploy contract first.`);
}

const deployments = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
const registry = deployments.DiplomaRegistry;
if (!registry) throw new Error(`Missing DiplomaRegistry in ${deploymentsPath}`);

function upsertEnvFile(filePath, updates) {
  const abs = path.resolve(filePath);
  const existing = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8") : "";
  const lines = existing.split(/\r?\n/).filter(Boolean);

  const map = new Map();
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    map.set(line.slice(0, idx), line.slice(idx + 1));
  }

  for (const [k, v] of Object.entries(updates)) map.set(k, v);

  const out = Array.from(map.entries())
    .map(([k, v]) => `${k}=${v}`)
    .join("\n") + "\n";

  fs.writeFileSync(abs, out, "utf8");
  console.log(`Updated ${filePath}`);
}

upsertEnvFile(".env", {
  REGISTRY_ADDRESS: registry,
});

upsertEnvFile("apps/web/.env.local", {
  NEXT_PUBLIC_REGISTRY_ADDRESS: registry,
  NEXT_PUBLIC_CHAIN_ID: String(chainId),
  // RPC URL zostawiasz ręcznie w .env.local albo też tu ustawiasz, jeśli chcesz:
  NEXT_PUBLIC_RPC_URL: process.env.RPC_URL ?? ""
});

console.log(`Registry: ${registry}`);
