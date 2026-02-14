"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import { readFileAsText } from "@/lib/univerify/file";
import { makeStateLogger } from "@/lib/univerify/logs";
import { parseJson, validateDiplomaEnvelope } from "@/lib/univerify/json";
import { makePublicClient, readIsRevoked, readStatusWithProof, statusLabel } from "@/lib/univerify/registry";
import { writeRevokeFromBatchTx } from "@/lib/univerify/registryWrite";
import type { ChainState, TxState } from "@/lib/univerify/types";
import { ensureChain, getEthereum, makeWalletClient } from "@/lib/univerify/wallet";

function isBytes32Hex(v: string): v is Hex {
  return /^0x[0-9a-fA-F]{64}$/.test(v);
}

function isHexArray(v: unknown): v is Hex[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string" && isBytes32Hex(x));
}

export default function RevokePage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const [inputText, setInputText] = useState("");
  const [docHash, setDocHash] = useState<Hex | "">("");
  const [issuerInput, setIssuerInput] = useState<Address | "">("");
  const [batchIdInput, setBatchIdInput] = useState("1");
  const [proofText, setProofText] = useState("[]");
  const [status, setStatus] = useState<"Unknown" | "Valid" | "Revoked" | "-">("-");
  const [recordRevoked, setRecordRevoked] = useState<boolean | null>(null);

  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const isBusy = txState !== "idle";
  const hasWallet = !!account;

  function resetMessages() {
    setError("");
    setTxHash(null);
  }

  function parseBatchIdBigint(): bigint {
    if (!/^\d+$/.test(batchIdInput.trim())) throw new Error("Batch ID must be a non-negative integer.");
    return BigInt(batchIdInput.trim());
  }

  function resolveIssuer(): Address {
    if (issuerInput && isAddress(issuerInput)) return issuerInput;
    if (account) return account;
    throw new Error("Provide issuer address or connect issuer wallet.");
  }

  function parseProof(): Hex[] {
    const parsed = parseJson<unknown>(proofText);
    if (!parsed.ok) throw new Error("Proof JSON is invalid.");
    if (!isHexArray(parsed.value)) throw new Error("Proof must be JSON array of bytes32 hex values.");
    return parsed.value;
  }

  async function connect() {
    resetMessages();
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) return setError(`Invalid address returned by wallet: ${addr}`);
      setAccount(addr as Address);
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      log.push(`wallet connected: ${addr}`);
      log.push(`network ok (chainId=${TARGET_CHAIN_ID})`);
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
      log.push(`connect error: ${e?.message ?? String(e)}`);
    }
  }

  async function loadFile(file: File) {
    resetMessages();
    const text = await readFileAsText(file);
    setInputText(text);
    log.push(`file loaded: ${file.name}`);
  }

  function loadFromJsonInput() {
    resetMessages();
    const parsed = parseJson<unknown>(inputText);
    if (!parsed.ok) return setError(parsed.error);

    try {
      const raw = parsed.value as any;

      // Full diploma envelope (preferred)
      if (raw?.payload && raw?.proof) {
        const env = validateDiplomaEnvelope(raw);
        const h = hashPayload(env.payload);
        setDocHash(h);
        log.push(`docHash(payload)=${h}`);

        if (env.proof.type === "MERKLE_BATCH") {
          setBatchIdInput(String(env.proof.batchId));
          setProofText(JSON.stringify(env.proof.proof, null, 2));
          if (env.proof.issuer) setIssuerInput(env.proof.issuer);
          log.push(`loaded from envelope: batchId=${env.proof.batchId}, proofNodes=${env.proof.proof.length}`);
          return;
        }

        if (env.proof.merkle) {
          setBatchIdInput(String(env.proof.merkle.batchId));
          setProofText(JSON.stringify(env.proof.merkle.proof, null, 2));
          if (env.proof.issuer) setIssuerInput(env.proof.issuer);
          log.push(`loaded from legacy envelope+merkle: batchId=${env.proof.merkle.batchId}, proofNodes=${env.proof.merkle.proof.length}`);
          return;
        }

        throw new Error("Envelope does not contain Merkle proof data.");
      }

      // Proof JSON exported from issuer
      if (typeof raw?.docHash === "string" && typeof raw?.batchId !== "undefined" && Array.isArray(raw?.proof)) {
        if (!isBytes32Hex(raw.docHash)) throw new Error("Invalid docHash in proof JSON.");
        if (!isHexArray(raw.proof)) throw new Error("Invalid proof[] in proof JSON.");
        if (!/^\d+$/.test(String(raw.batchId))) throw new Error("Invalid batchId in proof JSON.");
        if (raw.issuer != null && (!isAddress(raw.issuer))) throw new Error("Invalid issuer in proof JSON.");

        setDocHash(raw.docHash);
        setBatchIdInput(String(raw.batchId));
        setProofText(JSON.stringify(raw.proof, null, 2));
        if (raw.issuer) setIssuerInput(raw.issuer);
        log.push(`loaded from proof JSON: docHash=${raw.docHash}, batchId=${raw.batchId}, proofNodes=${raw.proof.length}`);
        return;
      }

      throw new Error("Unsupported JSON format. Load diploma envelope or proof JSON.");
    } catch (e: any) {
      setError(e?.message ?? String(e));
      log.push(`load json error: ${e?.message ?? String(e)}`);
    }
  }

  async function refreshStatus() {
    resetMessages();
    if (!docHash || !isBytes32Hex(docHash)) return setError("Enter valid docHash.");

    try {
      const batchId = parseBatchIdBigint();
      const proof = parseProof();
      const issuer = resolveIssuer();

      const code = await readStatusWithProof({
        publicClient,
        registry: REGISTRY,
        docHash,
        issuer,
        batchId,
        proof,
      });
      const label = statusLabel(code);
      setStatus(label);

      const revoked = await readIsRevoked({
        publicClient,
        registry: REGISTRY,
        docHash,
        issuer,
        batchId,
      });
      setRecordRevoked(revoked);

      log.push(`statusWithProof=${code} (${label}), issuer=${issuer}`);
      log.push(`record.revoked=${revoked === null ? "UNAVAILABLE (old contract ABI)" : String(revoked)}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      log.push(`refresh status error: ${e?.message ?? String(e)}`);
    }
  }

  async function revoke() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!docHash || !isBytes32Hex(docHash)) return setError("Enter valid docHash.");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      const batchId = parseBatchIdBigint();
      const proof = parseProof();

      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });

      await writeRevokeFromBatchTx({
        docHash,
        batchId,
        proof,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
        onAfter: async () => {
          await refreshStatus();
        },
      });

      log.push(`revokeFromBatch sent: docHash=${docHash}, batchId=${batchId.toString()}, proofNodes=${proof.length}`);
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`revoke error: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Revoke</h1>

      <div className="uv-card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          Connect MetaMask
        </button>
        <div>
          <div><b>Account:</b> {account || "-"}</div>
          <div><b>Network:</b> {chainState === "ok" ? "OK" : chainState === "wrong" ? "Wrong network" : "-"}</div>
          <div><b>Registry:</b> <code>{REGISTRY}</code></div>
        </div>
      </div>

      <div className="uv-card">
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Step 1: Load Revoke Data</h2>
        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
          }}
        />

        <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Input JSON</label>
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          rows={10}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />
        <button onClick={loadFromJsonInput} className="uv-btn" style={{ marginTop: 10 }}>
          Load docHash + batchId + proof from JSON
        </button>
      </div>

      <div className="uv-card">
        <h2 style={{ fontSize: 22, fontWeight: 700 }}>Step 2: Review / Edit</h2>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>docHash (bytes32)</label>
        <input
          value={docHash}
          onChange={(e) => setDocHash((e.target.value.trim() as Hex) || "")}
          placeholder="0x..."
          style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
        />

        <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>issuer</label>
        <input
          value={issuerInput}
          onChange={(e) => setIssuerInput((e.target.value.trim() as Address) || "")}
          placeholder={account || "0x..."}
          style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
        />

        <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>batchId</label>
        <input
          value={batchIdInput}
          onChange={(e) => setBatchIdInput(e.target.value.trim())}
          style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
        />

        <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>proof[] JSON</label>
        <textarea
          value={proofText}
          onChange={(e) => setProofText(e.target.value)}
          rows={8}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />

        <div className="uv-actions">
          <button onClick={() => void refreshStatus()} disabled={isBusy} className="uv-btn">
            Refresh status (chain)
          </button>
          <button onClick={() => void revoke()} disabled={isBusy || !hasWallet} className="uv-btn uv-btn-danger">
            Revoke from batch (tx)
          </button>
        </div>
        <p className="uv-hint">Czerwony przycisk wykonuje transakcję nieodwracalną.</p>
      </div>

      <div style={{ marginTop: 18 }}>
        <p><b>Status:</b> {status}</p>
        {recordRevoked !== null && <p><b>Record revoked:</b> {String(recordRevoked)}</p>}
        {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}
        {error && <p style={{ color: "red" }}><b>Error:</b> {error}</p>}
        {txState !== "idle" && <p><b>State:</b> {txState}</p>}

        {logs.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: "#f0f0f0", maxHeight: 320, overflowY: "auto" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Logs</h3>
              <button onClick={log.clear} className="uv-btn">Clear logs</button>
            </div>
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
