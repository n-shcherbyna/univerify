"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import type { ChainState, TxState, DiplomaEnvelope } from "@/lib/univerify/types";
import { DiplomaPayloadSchema, formatZodError, type DiplomaPayload } from "@/lib/univerify/schema";
import { makePublicClient, readIssuerUniversityId, readUniversityMeta } from "@/lib/univerify/registry";
import { downloadJson, parseJson } from "@/lib/univerify/json";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import { writeIssueBatchRootTx } from "@/lib/univerify/registryWrite";
import { buildMerkleFromLeaves, computeMerkleLeaf } from "@/lib/univerify/merkle";

const UINT64_MAX = (1n << 64n) - 1n;

type BatchItem = {
  index: number;
  payload: DiplomaPayload;
  docHash: Hex;
  leaf: Hex;
  proof: Hex[];
};

type ComputedBatch = {
  batchIdBigint: bigint;
  batchIdNumber: number;
  merkleRoot: Hex;
  items: BatchItem[];
};

function payloadLabel(payload: DiplomaPayload, index: number): string {
  const first = payload.student?.firstName ?? "";
  const last = payload.student?.lastName ?? "";
  if (first || last) return `${first} ${last}`.trim();
  if (payload.diplomaNumber) return String(payload.diplomaNumber);
  return `#${index}`;
}

export default function IssuerPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID, deployBlock: DEPLOY_BLOCK } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL, TARGET_CHAIN_ID), [RPC_URL, TARGET_CHAIN_ID]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [accountUniversityName, setAccountUniversityName] = useState<string | null>(null);
  const [accountUniversityId, setAccountUniversityId] = useState<bigint | null>(null);

  const [batchIdInput, setBatchIdInput] = useState("1");
  const [batchPayloadsText, setBatchPayloadsText] = useState(
    `[
  {
    "student": { "firstName": "Jan", "lastName": "Kowalski", "studentId": "s123456" },
    "degree": { "name": "Bachelor of Computer Science", "level": "BSc" },
    "issuedAt": "2025-06-30",
    "diplomaNumber": "UV-2025-000123"
  },
  {
    "student": { "firstName": "Anna", "lastName": "Nowak", "studentId": "s123457" },
    "degree": { "name": "Bachelor of Computer Science", "level": "BSc" },
    "issuedAt": "2025-06-30",
    "diplomaNumber": "UV-2025-000124"
  }
]`.trim()
  );

  const [computedBatch, setComputedBatch] = useState<ComputedBatch | null>(null);
  const [pendingPublish, setPendingPublish] = useState(false);
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const isBusy = txState !== "idle";

  function resetMessages() { setError(""); setTxHash(null); }

  function parseBatchId(input: string): { batchIdBigint: bigint; batchIdNumber: number } {
    if (!/^\d+$/.test(input.trim())) throw new Error("Batch ID must be a non-negative integer.");
    const v = BigInt(input.trim());
    if (v > UINT64_MAX) throw new Error("Batch ID exceeds uint64 range.");
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Batch ID must be ≤ ${Number.MAX_SAFE_INTEGER}.`);
    return { batchIdBigint: v, batchIdNumber: Number(v) };
  }

  async function connect() {
    resetMessages();
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh.");
    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) return setError(`Invalid address: ${addr}`);
      setAccount(addr as Address);
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const uid = await readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer: addr as Address });
      setAccountUniversityId(uid === 0n ? null : uid);
      if (uid > 0n) {
        const meta = await readUniversityMeta({ publicClient, registry: REGISTRY, universityId: uid, fromBlock: DEPLOY_BLOCK });
        setAccountUniversityName(meta?.name ?? null);
        log.push(`connected: ${addr} | ${meta?.name ?? `university ID ${uid}`}`);
      } else {
        setAccountUniversityName(null);
        log.push(`connected: ${addr} | not registered as issuer`);
      }
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  function computeBatch() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!accountUniversityId) return setError("This wallet is not registered as an issuer.");
    try {
      const parsed = parseJson<unknown[]>(batchPayloadsText);
      if (!parsed.ok) throw new Error(parsed.error);
      if (!Array.isArray(parsed.value) || parsed.value.length === 0) throw new Error("Must be a non-empty JSON array.");
      if (parsed.value.length > 10_000) throw new Error("Maximum 10 000 diplomas per batch.");
      const { batchIdBigint, batchIdNumber } = parseBatchId(batchIdInput);
      const payloads: DiplomaPayload[] = parsed.value.map((p, i) => {
        try {
          return DiplomaPayloadSchema.parse(p);
        } catch (e: unknown) {
          throw new Error(`Payload [${i}] invalid: ${formatZodError(e)}`);
        }
      });
      const chainId = BigInt(TARGET_CHAIN_ID);
      const docHashes = payloads.map((p) => hashPayload(p));
      const leaves = docHashes.map((docHash) =>
        computeMerkleLeaf({ registry: REGISTRY, chainId, issuer: account, batchId: batchIdBigint, docHash })
      );
      const { root, proofs } = buildMerkleFromLeaves(leaves);
      const items: BatchItem[] = payloads.map((payload, i) => ({
        index: i, payload, docHash: docHashes[i], leaf: leaves[i], proof: proofs[i],
      }));
      setComputedBatch({ batchIdBigint, batchIdNumber, merkleRoot: root, items });
      log.push(`batch computed | id=${batchIdBigint} items=${items.length} root=${root}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function publishBatchRoot() {
    resetMessages();
    if (!account || !computedBatch) return;
    setPendingPublish(false);
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      const walletClient = makeWalletClient({ eth, account, chainId: TARGET_CHAIN_ID });
      await writeIssueBatchRootTx({
        batchId: computedBatch.batchIdBigint,
        merkleRoot: computedBatch.merkleRoot,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });
      log.push(`root published | batchId=${computedBatch.batchIdBigint} root=${computedBatch.merkleRoot}`);
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  function exportAll() {
    resetMessages();
    if (!computedBatch || !account) return;
    for (const item of computedBatch.items) {
      const envelope: DiplomaEnvelope = {
        payload: item.payload,
        proof: { type: "MERKLE_BATCH", batchId: computedBatch.batchIdNumber, proof: item.proof, issuer: account },
      };
      downloadJson(`diploma-${computedBatch.batchIdNumber}-${item.index}.json`, envelope);
    }
    log.push(`exported ${computedBatch.items.length} diplomas`);
  }

  function exportSingle(item: BatchItem) {
    resetMessages();
    if (!computedBatch || !account) return;
    const envelope: DiplomaEnvelope = {
      payload: item.payload,
      proof: { type: "MERKLE_BATCH", batchId: computedBatch.batchIdNumber, proof: item.proof, issuer: account },
    };
    downloadJson(`diploma-${computedBatch.batchIdNumber}-${item.index}.json`, envelope);
    log.push(`exported diploma [${item.index}]: ${item.docHash}`);
  }

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify — Issuer</h1>
      <p className="uv-subtitle">Build a Merkle batch, publish the root on-chain, and export diploma files.</p>

      {/* Wallet */}
      <div className="uv-card" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          {account ? "Reconnect" : "Connect MetaMask"}
        </button>
        <div className="uv-kv" style={{ flex: 1, minWidth: 260, gap: "4px 16px" }}>
          <b>Account</b>
          <code style={{ fontSize: 12 }}>{account || "—"}</code>
          <b>University</b>
          <span>{accountUniversityName ?? (accountUniversityId ? `ID ${accountUniversityId}` : "Not registered")}</span>
          <b>Network</b>
          <span style={{ color: chainState === "ok" ? "green" : chainState === "wrong" ? "red" : undefined }}>
            {chainState === "ok" ? "Sepolia ✓" : chainState === "wrong" ? "Wrong network" : "—"}
          </span>
        </div>
      </div>

      {/* Step 1 */}
      <div className="uv-card">
        <h2 className="uv-card-title">Step 1 — Prepare & publish batch</h2>

        <label className="uv-label">Batch ID</label>
        <input
          className="uv-input"
          value={batchIdInput}
          onChange={(e) => { setBatchIdInput(e.target.value.trim()); setComputedBatch(null); resetMessages(); }}
          style={{ width: 160 }}
        />

        <label className="uv-label" style={{ marginTop: 14 }}>Payloads JSON (array)</label>
        <textarea
          value={batchPayloadsText}
          onChange={(e) => { setBatchPayloadsText(e.target.value); setComputedBatch(null); resetMessages(); }}
          rows={10}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />

        <div className="uv-actions">
          <button onClick={computeBatch} disabled={isBusy || !account} className="uv-btn">
            Compute
          </button>
          <button
            onClick={() => { resetMessages(); setPendingPublish(true); }}
            disabled={isBusy || !account || !computedBatch}
            className="uv-btn uv-btn-primary"
          >
            {txState === "submitting" ? "Submitting…" : txState === "confirming" ? "Confirming…" : "Publish root on-chain"}
          </button>
        </div>

        {txHash && <p style={{ marginTop: 8, fontSize: 13 }}>Tx: <code>{txHash}</code></p>}

        {computedBatch && (
          <div className="uv-kv" style={{ marginTop: 12 }}>
            <b>Batch ID</b><span>{computedBatch.batchIdBigint.toString()}</span>
            <b>Diplomas</b><span>{computedBatch.items.length}</span>
            <b>Merkle root</b><code style={{ fontSize: 12 }}>{computedBatch.merkleRoot}</code>
          </div>
        )}
      </div>

      {/* Step 2 */}
      {computedBatch && (
        <div className="uv-card">
          <h2 className="uv-card-title">Step 2 — Export diploma files</h2>
          <p className="uv-hint" style={{ marginBottom: 14 }}>
            Each file contains the payload and Merkle proof. No signing required — the issuer identity is proven by the on-chain transaction.
          </p>

          <div className="uv-actions" style={{ marginBottom: 16 }}>
            <button onClick={exportAll} disabled={isBusy} className="uv-btn uv-btn-primary">
              Export all ({computedBatch.items.length})
            </button>
          </div>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #eee", textAlign: "left" }}>
                <th style={{ padding: "6px 8px" }}>#</th>
                <th style={{ padding: "6px 8px" }}>Name / ID</th>
                <th style={{ padding: "6px 8px" }}>docHash</th>
                <th style={{ padding: "6px 8px" }}>Proof nodes</th>
                <th style={{ padding: "6px 8px" }}></th>
              </tr>
            </thead>
            <tbody>
              {computedBatch.items.map((item) => (
                <tr key={item.index} style={{ borderBottom: "1px solid #f0f0f0" }}>
                  <td style={{ padding: "6px 8px" }}>{item.index}</td>
                  <td style={{ padding: "6px 8px" }}>{payloadLabel(item.payload, item.index)}</td>
                  <td style={{ padding: "6px 8px" }}><code style={{ fontSize: 11 }}>{item.docHash.slice(0, 12)}…</code></td>
                  <td style={{ padding: "6px 8px" }}>{item.proof.length}</td>
                  <td style={{ padding: "6px 8px" }}>
                    <button onClick={() => exportSingle(item)} disabled={isBusy} className="uv-btn" style={{ padding: "3px 10px", fontSize: 12 }}>
                      Export
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Publish confirmation modal */}
      {pendingPublish && computedBatch && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 100,
        }}>
          <div className="uv-card" style={{ maxWidth: 480, width: "100%", margin: 16 }}>
            <h2 className="uv-card-title" style={{ marginBottom: 12 }}>Confirm publish</h2>
            <p style={{ fontSize: 14, marginBottom: 12, color: "var(--muted)" }}>
              This will send an on-chain transaction. The batch root cannot be changed after publishing.
            </p>
            <div className="uv-kv" style={{ marginTop: 0 }}>
              <b>Batch ID</b><span>{computedBatch.batchIdBigint.toString()}</span>
              <b>Diplomas</b><span>{computedBatch.items.length}</span>
              <b>Registry</b><code style={{ fontSize: 12, wordBreak: "break-all" }}>{REGISTRY}</code>
              <b>Merkle root</b><code style={{ fontSize: 11, wordBreak: "break-all" }}>{computedBatch.merkleRoot}</code>
            </div>
            <div className="uv-actions" style={{ marginTop: 16 }}>
              <button onClick={() => void publishBatchRoot()} className="uv-btn uv-btn-primary">
                Confirm & sign transaction
              </button>
              <button onClick={() => setPendingPublish(false)} className="uv-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {error && <div className="uv-status-banner uv-status-fail" style={{ marginTop: 12 }}><b>Error:</b> {error}</div>}

      {logs.length > 0 && (
        <div className="uv-card" style={{ maxHeight: 240, overflowY: "auto", marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0 }}>Logs</h3>
            <button onClick={log.clear} className="uv-btn">Clear</button>
          </div>
          <pre style={{ fontFamily: "monospace", fontSize: 12, marginTop: 8 }}>
            {logs.map((line, idx) => <div key={idx}>{line}</div>)}
          </pre>
        </div>
      )}
    </main>
  );
}
