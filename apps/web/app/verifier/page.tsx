"use client";

import { useMemo, useState } from "react";
import {
  createPublicClient,
  http,
  isAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import { DiplomaRegistryAbi, type StatusCode, hashPayload } from "@univerify/verifier-core";

type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

type DiplomaTypes = {
  Diploma: readonly [{ name: "docHash"; type: "bytes32" }];
};

type DiplomaEnvelope = {
  payload: unknown;
  proof: {
    type: "EIP712";
    domain: Eip712Domain;
    types: DiplomaTypes;
    primaryType: "Diploma";
    signature: Hex;

    // optional informational fields
    issuer?: Address;
    issuedAt?: string;
  };
};

function statusLabel(code: StatusCode) {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

function requireDefined(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function requireAddress(value: string | undefined, name: string): Address {
  const v = requireDefined(value, name);
  if (!isAddress(v)) throw new Error(`Invalid address in env var ${name}: ${v}`);
  return v as Address;
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ""));
    r.onerror = () => reject(new Error("Failed to read file"));
    r.readAsText(file);
  });
}

function validateEnvelope(obj: any): DiplomaEnvelope {
  if (!obj || typeof obj !== "object") throw new Error("Envelope must be an object");
  if (!("payload" in obj)) throw new Error('Envelope missing "payload"');
  if (!("proof" in obj)) throw new Error('Envelope missing "proof"');

  const proof = obj.proof;
  if (!proof || typeof proof !== "object") throw new Error('"proof" must be an object');
  if (proof.type !== "EIP712") throw new Error('Unsupported proof.type (expected "EIP712")');

  if (!proof.domain || typeof proof.domain !== "object") throw new Error('Missing proof.domain');
  if (typeof proof.domain.name !== "string") throw new Error("Invalid proof.domain.name");
  if (typeof proof.domain.version !== "string") throw new Error("Invalid proof.domain.version");
  if (typeof proof.domain.chainId !== "number") throw new Error("Invalid proof.domain.chainId");
  if (typeof proof.domain.verifyingContract !== "string" || !isAddress(proof.domain.verifyingContract)) {
    throw new Error("Invalid proof.domain.verifyingContract");
  }

  if (!proof.types || typeof proof.types !== "object") throw new Error("Missing proof.types");
  if (proof.primaryType !== "Diploma") throw new Error('Invalid proof.primaryType (expected "Diploma")');

  if (typeof proof.signature !== "string" || !proof.signature.startsWith("0x")) {
    throw new Error('Invalid proof.signature (expected 0x...)');
  }

  return obj as DiplomaEnvelope;
}

export default function VerifyPage() {
  const RPC_URL = useMemo(
    () => requireDefined(process.env.NEXT_PUBLIC_RPC_URL, "NEXT_PUBLIC_RPC_URL"),
    []
  );

  const REGISTRY = useMemo(
    () => requireAddress(process.env.NEXT_PUBLIC_REGISTRY_ADDRESS, "NEXT_PUBLIC_REGISTRY_ADDRESS"),
    []
  );

  const publicClient = useMemo(
    () => createPublicClient({ chain: sepolia, transport: http(RPC_URL) }),
    [RPC_URL]
  );

  const [envelopeText, setEnvelopeText] = useState<string>("");

  const [docHash, setDocHash] = useState<Hex | null>(null);
  const [recovered, setRecovered] = useState<Address | null>(null);

  const [onChainStatus, setOnChainStatus] = useState<string>("");
  const [onChainIssuer, setOnChainIssuer] = useState<Address | null>(null);
  const [onChainIssuedAt, setOnChainIssuedAt] = useState<string>("");
  const [onChainRevoked, setOnChainRevoked] = useState<boolean | null>(null);

  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string>("");

  function pushLog(msg: string) {
    setLogs((prev) => [...prev, msg]);
    // eslint-disable-next-line no-console
    console.log(msg);
  }

  function reset() {
    setError("");
    setLogs([]);
    setVerifyOk(null);
    setDocHash(null);
    setRecovered(null);
    setOnChainStatus("");
    setOnChainIssuer(null);
    setOnChainIssuedAt("");
    setOnChainRevoked(null);
  }

  async function loadFile(file: File) {
    reset();
    const text = await readFileAsText(file);
    setEnvelopeText(text);
  }

  async function verify() {
    reset();

    if (!envelopeText.trim()) {
      setError("Paste envelope JSON or upload a file first.");
      return;
    }

    try {
      pushLog("=== UniVerify verifier (EIP-712) ===");
      pushLog(`registry(env): ${REGISTRY}`);

      const obj = JSON.parse(envelopeText);
      const env = validateEnvelope(obj);

      pushLog(`proof.type: ${env.proof.type}`);
      pushLog(`domain.name: ${env.proof.domain.name}`);
      pushLog(`domain.version: ${env.proof.domain.version}`);
      pushLog(`domain.chainId: ${env.proof.domain.chainId}`);
      pushLog(`domain.verifyingContract: ${env.proof.domain.verifyingContract}`);
      pushLog(`signature: ${env.proof.signature}`);

      // Optional: enforce that envelope is for THIS app/contract.
      // If you want it strict, keep these checks; otherwise remove them.
      if (env.proof.domain.verifyingContract.toLowerCase() !== REGISTRY.toLowerCase()) {
        throw new Error("Envelope verifyingContract does not match configured REGISTRY.");
      }

      // 1) compute docHash(payload)
      const h = hashPayload(env.payload);
      setDocHash(h);
      pushLog(`docHash(payload): ${h}`);

      // 2) recover signer from typed-data signature
      const rec = await recoverTypedDataAddress({
        domain: env.proof.domain,
        types: env.proof.types,
        primaryType: env.proof.primaryType,
        message: { docHash: h },
        signature: env.proof.signature,
      });

      setRecovered(rec);
      pushLog(`recovered signer: ${rec}`);

      // 3) on-chain status + record
      const code = (await publicClient.readContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: "status",
        args: [h],
      })) as StatusCode;

      const label = statusLabel(code);
      setOnChainStatus(label);
      pushLog(`on-chain status: ${code} (${label})`);

      const [issuer, issuedAt, revoked] = (await publicClient.readContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: "get",
        args: [h],
      })) as readonly [Address, bigint, boolean];

      setOnChainIssuer(issuer);
      setOnChainRevoked(revoked);

      const issuedAtIso =
        issuer === "0x0000000000000000000000000000000000000000"
          ? "-"
          : new Date(Number(issuedAt) * 1000).toISOString();

      setOnChainIssuedAt(issuedAtIso);

      pushLog(`on-chain issuer: ${issuer}`);
      pushLog(`on-chain issuedAt: ${issuedAtIso}`);
      pushLog(`on-chain revoked: ${String(revoked)}`);

      // 4) checks
      const statusOk = code === 1;
      const issuerOk = rec.toLowerCase() === issuer.toLowerCase();

      pushLog(`check: status == Valid -> ${statusOk ? "OK" : "FAIL"}`);
      pushLog(`check: recovered == onChainIssuer -> ${issuerOk ? "OK" : "FAIL"}`);

      const ok = statusOk && issuerOk;
      setVerifyOk(ok);

      pushLog(`RESULT: ${ok ? "VERIFIED ✅" : "NOT VERIFIED ❌"}`);

      if (!ok) {
        if (!statusOk) pushLog(`reason: expected status Valid (1), got ${code} (${label})`);
        if (!issuerOk) pushLog("reason: signature does not match on-chain issuer");
      }
    } catch (e: any) {
      setVerifyOk(false);
      setError(e?.message ?? String(e));
      pushLog(`ERROR: ${e?.message ?? String(e)}`);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Verifier</h1>

      <div style={{ marginTop: 12 }}>
        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
          }}
        />
      </div>

      <div style={{ marginTop: 12 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
          Envelope JSON (payload + proof.EIP712)
        </label>
        <textarea
          value={envelopeText}
          onChange={(e) => setEnvelopeText(e.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={verify} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Verify
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {docHash && <p><b>docHash:</b> <code>{docHash}</code></p>}
        {recovered && <p><b>recovered signer:</b> <code>{recovered}</code></p>}

        {onChainStatus && <p><b>on-chain status:</b> {onChainStatus}</p>}

        {onChainIssuer && (
          <div>
            <p><b>on-chain record:</b></p>
            <ul>
              <li><b>issuer:</b> <code>{onChainIssuer}</code></li>
              <li><b>issuedAt:</b> {onChainIssuedAt || "-"}</li>
              <li><b>revoked:</b> {String(onChainRevoked)}</li>
            </ul>
          </div>
        )}

        {error && <p style={{ color: "red" }}><b>Error:</b> {error}</p>}

        {verifyOk !== null && (
          <p style={{ color: verifyOk ? "green" : "red" }}>
            <b>Verification result:</b> {verifyOk ? "VERIFIED ✅" : "NOT VERIFIED ❌"}
          </p>
        )}

        {logs.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: "#f0f0f0", maxHeight: 300, overflowY: "auto" }}>
            <h3>Logs:</h3>
            <pre style={{ fontFamily: "monospace", fontSize: 12 }}>
              {logs.map((line, idx) => (
                <div key={idx}>{line}</div>
              ))}
            </pre>
          </div>
        )}
      </div>
    </main>
  );
}
