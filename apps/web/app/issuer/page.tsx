"use client";

import { useEffect, useMemo, useState } from "react";
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

const BATCH_STORAGE_KEY = "univerify:issuer:computedBatch";

function serializeBatch(batch: ComputedBatch): string {
  return JSON.stringify({ ...batch, batchIdBigint: batch.batchIdBigint.toString() });
}

function deserializeBatch(json: string): ComputedBatch | null {
  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== "object") return null;
    return { ...raw, batchIdBigint: BigInt(raw.batchIdBigint) } as ComputedBatch;
  } catch {
    return null;
  }
}

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

  useEffect(() => {
    const stored = localStorage.getItem(BATCH_STORAGE_KEY);
    if (stored) {
      const batch = deserializeBatch(stored);
      if (batch) setComputedBatch(batch);
    }
  }, []);

  function resetMessages() { setError(""); setTxHash(null); }

  function parseBatchId(input: string): { batchIdBigint: bigint; batchIdNumber: number } {
    if (!/^\d+$/.test(input.trim())) throw new Error("Batch ID must be a non-negative integer.");
    const v = BigInt(input.trim());
    if (v > UINT64_MAX) throw new Error("Batch ID exceeds uint64 range.");
    if (v > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error(`Batch ID must be \u2264 ${Number.MAX_SAFE_INTEGER}.`);
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
    } catch (e: unknown) {
      setChainState("wrong");
      setError(e instanceof Error ? e.message : String(e));
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
      const batch: ComputedBatch = { batchIdBigint, batchIdNumber, merkleRoot: root, items };
      setComputedBatch(batch);
      localStorage.setItem(BATCH_STORAGE_KEY, serializeBatch(batch));
      log.push(`batch computed | id=${batchIdBigint} items=${items.length} root=${root}`);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
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
    } catch (e: unknown) {
      setTxState("idle");
      setError(e instanceof Error ? e.message : String(e));
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
      <h1 className="uv-title"><span className="uv-title-gradient">Issuer</span></h1>
      <p className="uv-subtitle">Build a Merkle batch, publish the root on-chain, and export diploma files.</p>

      {/* Wallet */}
      <div className="uv-card uv-wallet-bar">
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          {account ? "Reconnect" : "Connect MetaMask"}
        </button>
        <div className="uv-kv" style={{ flex: 1, minWidth: 260, gap: "4px 16px", marginTop: 0 }}>
          <b>Account</b>
          <code>{account || "\u2014"}</code>
          <b>University</b>
          <span>{accountUniversityName ?? (accountUniversityId ? `ID ${accountUniversityId}` : "Not registered")}</span>
          <b>Network</b>
          <span style={{ color: chainState === "ok" ? "var(--success)" : chainState === "wrong" ? "var(--danger)" : undefined }}>
            {chainState === "ok" ? "Sepolia \u2713" : chainState === "wrong" ? "Wrong network" : "\u2014"}
          </span>
        </div>
      </div>

      {/* Step 1 */}
      <div className="uv-card">
        <h2 className="uv-card-title">Step 1 &mdash; Prepare & publish batch</h2>

        <div style={{ marginTop: 14 }}>
          <label className="uv-label">Batch ID</label>
          <input
            className="uv-input uv-mono"
            value={batchIdInput}
            onChange={(e) => { setBatchIdInput(e.target.value.trim()); setComputedBatch(null); localStorage.removeItem(BATCH_STORAGE_KEY); resetMessages(); }}
            style={{ width: 160 }}
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="uv-label">Payloads JSON (array)</label>
          <textarea
            value={batchPayloadsText}
            onChange={(e) => { setBatchPayloadsText(e.target.value); setComputedBatch(null); localStorage.removeItem(BATCH_STORAGE_KEY); resetMessages(); }}
            className="uv-input"
            rows={10}
            style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
          />
        </div>

        <div className="uv-actions">
          <button onClick={computeBatch} disabled={isBusy || !account} className="uv-btn">
            Compute
          </button>
          <button
            onClick={() => { resetMessages(); setPendingPublish(true); }}
            disabled={isBusy || !account || !computedBatch}
            className="uv-btn uv-btn-primary"
          >
            {txState === "submitting" ? "Submitting\u2026" : txState === "confirming" ? "Confirming\u2026" : "Publish root on-chain"}
          </button>
        </div>

        {txHash && <p className="uv-hint">Tx: <code>{txHash}</code></p>}

        {computedBatch && (
          <div className="uv-kv" style={{ marginTop: 14 }}>
            <b>Batch ID</b><span>{computedBatch.batchIdBigint.toString()}</span>
            <b>Diplomas</b><span>{computedBatch.items.length}</span>
            <b>Merkle root</b><code>{computedBatch.merkleRoot}</code>
          </div>
        )}
      </div>

      {/* Step 2 */}
      {computedBatch && (
        <div className="uv-card">
          <h2 className="uv-card-title">Step 2 &mdash; Export diploma files</h2>
          {typeof window !== "undefined" && localStorage.getItem(BATCH_STORAGE_KEY) && !isBusy && (
            <p className="uv-hint" style={{ marginBottom: 8 }}>
              Batch restored from previous session.{" "}
              <button
                className="uv-btn"
                style={{ padding: "2px 10px", fontSize: 12 }}
                onClick={() => { setComputedBatch(null); localStorage.removeItem(BATCH_STORAGE_KEY); }}
              >
                Clear
              </button>
            </p>
          )}
          <p className="uv-hint" style={{ marginBottom: 16 }}>
            Each file contains the payload and Merkle proof. No signing required &mdash; the issuer identity is proven by the on-chain transaction.
          </p>

          <div className="uv-actions" style={{ marginBottom: 16, marginTop: 0 }}>
            <button onClick={exportAll} disabled={isBusy} className="uv-btn uv-btn-primary">
              Export all ({computedBatch.items.length})
            </button>
          </div>

          <div className="uv-table-wrap">
            <table style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Name / ID</th>
                  <th>docHash</th>
                  <th>Proof nodes</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {computedBatch.items.map((item) => (
                  <tr key={item.index}>
                    <td>{item.index}</td>
                    <td style={{ fontWeight: 500 }}>{payloadLabel(item.payload, item.index)}</td>
                    <td><code style={{ fontSize: 11 }}>{item.docHash.slice(0, 12)}&hellip;</code></td>
                    <td>{item.proof.length}</td>
                    <td>
                      <button onClick={() => exportSingle(item)} disabled={isBusy} className="uv-btn" style={{ padding: "4px 12px", fontSize: 12 }}>
                        Export
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Publish confirmation modal */}
      {pendingPublish && computedBatch && (
        <div className="uv-modal-overlay">
          <div className="uv-card" style={{ maxWidth: 480, width: "100%", margin: 16 }}>
            <h2 className="uv-card-title" style={{ marginBottom: 12 }}>Confirm publish</h2>
            <p style={{ fontSize: 14, marginBottom: 12, color: "var(--muted)" }}>
              This will send an on-chain transaction. The batch root cannot be changed after publishing.
            </p>
            <div className="uv-kv" style={{ marginTop: 0 }}>
              <b>Batch ID</b><span>{computedBatch.batchIdBigint.toString()}</span>
              <b>Diplomas</b><span>{computedBatch.items.length}</span>
              <b>Registry</b><code>{REGISTRY}</code>
              <b>Merkle root</b><code style={{ fontSize: 11 }}>{computedBatch.merkleRoot}</code>
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
        <div className="uv-card uv-logs" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Logs</h3>
            <button onClick={log.clear} className="uv-btn" style={{ padding: "4px 12px", fontSize: 12 }}>Clear</button>
          </div>
          <pre>
            {logs.map((line, idx) => <div key={idx}>{line}</div>)}
          </pre>
        </div>
      )}
    </main>
  );
}
