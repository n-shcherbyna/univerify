"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import { readFileAsText } from "@/lib/univerify/file";
import { makeStateLogger } from "@/lib/univerify/logs";
import { parseJson, validateDiplomaEnvelope } from "@/lib/univerify/json";
import { makePublicClient, readStatusWithProof, statusLabel } from "@/lib/univerify/registry";
import { writeRevokeFromBatchTx } from "@/lib/univerify/registryWrite";
import type { ChainState, TxState, DiplomaEnvelope } from "@/lib/univerify/types";
import { ensureChain, getEthereum, makeWalletClient } from "@/lib/univerify/wallet";

export default function RevokePage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL, TARGET_CHAIN_ID), [RPC_URL, TARGET_CHAIN_ID]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);

  const [envelopeText, setEnvelopeText] = useState("");
  const [envelope, setEnvelope] = useState<DiplomaEnvelope | null>(null);
  const [previewStatus, setPreviewStatus] = useState<"idle" | "loading" | "loaded" | "error">("idle");
  const [onChainStatus, setOnChainStatus] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);

  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const isBusy = txState !== "idle";
  const hasWallet = !!account;

  function resetMessages() {
    setError("");
    setTxHash(null);
  }

  async function fetchStatus(env: DiplomaEnvelope) {
    setPreviewStatus("loading");
    try {
      const docHash = hashPayload(env.payload);
      const code = await readStatusWithProof({
        publicClient,
        registry: REGISTRY,
        docHash,
        issuer: env.proof.issuer,
        batchId: BigInt(env.proof.batchId),
        proof: env.proof.proof,
      });
      setOnChainStatus(statusLabel(code));
      setPreviewStatus("loaded");
      log.push(`on-chain status: ${statusLabel(code)}`);
    } catch (e: unknown) {
      setPreviewStatus("error");
      log.push(`status fetch error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function parseAndLoad(text: string) {
    resetMessages();
    setEnvelope(null);
    setPreviewStatus("idle");
    setOnChainStatus(null);
    if (!text.trim()) return;

    try {
      const parsed = parseJson<unknown>(text);
      if (!parsed.ok) throw new Error(parsed.error);
      const env = validateDiplomaEnvelope(parsed.value);
      setEnvelope(env);
      log.push(`envelope parsed: batchId=${env.proof.batchId}, issuer=${env.proof.issuer}`);
      await fetchStatus(env);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      log.push(`parse error: ${msg}`);
    }
  }

  async function loadFile(file: File) {
    const text = await readFileAsText(file);
    setEnvelopeText(text);
    log.push(`file loaded: ${file.name}`);
    await parseAndLoad(text);
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
    } catch (e: unknown) {
      setChainState("wrong");
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      log.push(`connect error: ${msg}`);
    }
  }

  async function revoke() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!envelope) return setError("Load a diploma envelope first.");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      const docHash = hashPayload(envelope.payload);
      const batchId = BigInt(envelope.proof.batchId);
      const proof = envelope.proof.proof;

      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account, chainId: TARGET_CHAIN_ID });

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
          await fetchStatus(envelope);
        },
      });

      log.push(`revokeFromBatch sent: docHash=${docHash}, batchId=${batchId.toString()}`);
    } catch (e: unknown) {
      setTxState("idle");
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      log.push(`revoke error: ${msg}`);
    }
  }

  const payload = envelope?.payload;

  return (
    <main className="uv-page">
      <h1 className="uv-title"><span className="uv-title-gradient">Revoke</span></h1>
      <p className="uv-subtitle">Load a diploma envelope and revoke it on-chain.</p>

      {/* Wallet */}
      <div className="uv-card uv-wallet-bar">
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          {account ? "Reconnect" : "Connect MetaMask"}
        </button>
        <div className="uv-kv" style={{ flex: 1, minWidth: 260, gap: "4px 16px", marginTop: 0 }}>
          <b>Account</b>
          <code>{account || "\u2014"}</code>
          <b>Network</b>
          <span style={{ color: chainState === "ok" ? "var(--success)" : chainState === "wrong" ? "var(--danger)" : undefined }}>
            {chainState === "ok" ? "OK \u2713" : chainState === "wrong" ? "Wrong network" : "\u2014"}
          </span>
        </div>
      </div>

      {/* Load envelope */}
      <div className="uv-card">
        <h2 className="uv-card-title">Load diploma envelope</h2>
        <div className="uv-file-zone" style={{ marginTop: 12 }}>
          <input
            type="file"
            accept="application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
            }}
          />
        </div>
        <div style={{ marginTop: 14 }}>
          <label className="uv-label">Or paste envelope JSON</label>
          <textarea
            value={envelopeText}
            onChange={(e) => {
              setEnvelopeText(e.target.value);
              void parseAndLoad(e.target.value);
            }}
            className="uv-input"
            rows={8}
            placeholder='{ "payload": { ... }, "proof": { "type": "MERKLE_BATCH", ... } }'
            style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>
      </div>

      {/* Diploma preview */}
      {envelope && payload && (
        <div className="uv-card">
          <h2 className="uv-card-title">Diploma preview</h2>
          <div className="uv-kv">
            <b>Student</b><span>{payload.student.firstName} {payload.student.lastName}</span>
            <b>Student ID</b><span>{payload.student.studentId}</span>
            <b>Degree</b><span>{payload.degree.name}</span>
            <b>Level</b><span>{payload.degree.level}</span>
            <b>Issued</b><span>{payload.issuedAt}</span>
            <b>Diploma No.</b><span>{payload.diplomaNumber}</span>
            <b>Batch ID</b><span>{envelope.proof.batchId}</span>
            <b>Issuer</b><code>{envelope.proof.issuer}</code>
            <b>On-chain status</b>
            <span>
              {previewStatus === "loading" ? "Loading\u2026" : previewStatus === "error" ? "Failed to fetch" : onChainStatus ?? "\u2014"}
            </span>
          </div>
          <div className="uv-actions" style={{ marginTop: 16 }}>
            <button
              onClick={() => setConfirmRevoke(true)}
              disabled={isBusy || !hasWallet}
              className="uv-btn uv-btn-danger"
            >
              Revoke diploma
            </button>
          </div>
          <p className="uv-hint">The button above sends an irreversible blockchain transaction.</p>
        </div>
      )}

      {/* Status / tx feedback */}
      {(txHash || txState !== "idle") && (
        <div className="uv-status-banner uv-status-warn">
          {txHash && <p style={{ margin: 0 }}><b>Tx:</b> <code>{txHash}</code></p>}
          {txState !== "idle" && <p style={{ margin: txHash ? "6px 0 0" : 0 }}><b>State:</b> {txState}</p>}
        </div>
      )}
      {error && (
        <div className="uv-status-banner uv-status-fail">
          <b>Error:</b> {error}
        </div>
      )}

      {/* Confirmation modal */}
      {confirmRevoke && envelope && payload && (
        <div className="uv-modal-overlay">
          <div className="uv-card" style={{ maxWidth: 480, width: "100%", margin: 16 }}>
            <h2 className="uv-card-title" style={{ marginBottom: 12 }}>Confirm revocation</h2>
            <p style={{ fontSize: 14, marginBottom: 12, color: "var(--muted)" }}>
              This action is irreversible. The diploma will be permanently revoked on-chain.
            </p>
            <div className="uv-kv" style={{ marginTop: 0 }}>
              <b>Diploma No.</b><span>{payload.diplomaNumber}</span>
              <b>Student</b><span>{payload.student.firstName} {payload.student.lastName}</span>
              <b>Issuer</b><code>{envelope.proof.issuer}</code>
              <b>Batch ID</b><span>{envelope.proof.batchId}</span>
            </div>
            <div className="uv-actions" style={{ marginTop: 16 }}>
              <button
                onClick={() => { setConfirmRevoke(false); void revoke(); }}
                className="uv-btn uv-btn-danger"
                disabled={isBusy}
              >
                Confirm revocation
              </button>
              <button onClick={() => setConfirmRevoke(false)} className="uv-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {logs.length > 0 && (
        <div className="uv-card uv-logs">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Logs</h3>
            <button onClick={log.clear} className="uv-btn" style={{ padding: "4px 12px", fontSize: 12 }}>Clear</button>
          </div>
          <pre>
            {logs.map((line, idx) => (
              <div key={idx}>{line}</div>
            ))}
          </pre>
        </div>
      )}
    </main>
  );
}
