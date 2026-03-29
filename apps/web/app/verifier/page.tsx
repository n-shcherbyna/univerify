"use client";

import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import type { DiplomaEnvelope } from "@/lib/univerify/types";
import { DiplomaPayloadSchema, type DiplomaPayload } from "@/lib/univerify/schema";
import {
  makePublicClient,
  readBatch,
  readIsIssuer,
  readIsRevoked,
  readIssuerUniversityId,
  readStatusWithProof,
  readUniversityMeta,
  statusLabel,
  universityStatusLabel,
} from "@/lib/univerify/registry";
import { parseJson, validateDiplomaEnvelope } from "@/lib/univerify/json";
import { readFileAsText } from "@/lib/univerify/file";
import { makeStateLogger } from "@/lib/univerify/logs";
import { computeMerkleLeaf, computeRootFromProof } from "@/lib/univerify/merkle";

type VerifyState = {
  docHash: Hex | null;
  statusCode: 0 | 1 | 2;
  statusLabel: "Unknown" | "Valid" | "Revoked";
  batchId: number | null;
  onChainBatchRoot: Hex | null;
  merkleLeaf: Hex | null;
  merkleComputedRoot: Hex | null;
  merkleRootMatches: boolean | null;
  recordRevoked: boolean | null;
  issuer: Address | null;
  issuerTrustedNow: boolean | null;
  issuerUniversityId: bigint | null;
  universityName: string | null;
  universityCountry: string | null;
  universityWebsite: string | null;
  universityStatus: number | null;
  verifyOk: boolean | null;
  diplomaPayload: DiplomaPayload | null;
};

function emptyState(): VerifyState {
  return {
    docHash: null,
    statusCode: 0,
    statusLabel: "Unknown",
    batchId: null,
    onChainBatchRoot: null,
    merkleLeaf: null,
    merkleComputedRoot: null,
    merkleRootMatches: null,
    recordRevoked: null,
    issuer: null,
    issuerTrustedNow: null,
    issuerUniversityId: null,
    universityName: null,
    universityCountry: null,
    universityWebsite: null,
    universityStatus: null,
    verifyOk: null,
    diplomaPayload: null,
  };
}

function verificationFailures(state: VerifyState): string[] {
  if (state.verifyOk !== false) return [];
  const reasons: string[] = [];
  if (state.statusCode !== 1) reasons.push(`On-chain status is ${state.statusLabel}.`);
  if (state.merkleRootMatches === false) reasons.push("Merkle proof does not match on-chain batch root.");
  if (state.issuerTrustedNow === false) reasons.push("Issuer is not currently trusted on-chain.");
  if (state.universityStatus !== null && state.universityStatus !== 1) reasons.push("University is not active on-chain.");
  if (reasons.length === 0) reasons.push("Validation failed due to an internal consistency check.");
  return reasons;
}

export default function VerifyPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID, deployBlock: DEPLOY_BLOCK } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL, TARGET_CHAIN_ID), [RPC_URL, TARGET_CHAIN_ID]);

  const [envelopeText, setEnvelopeText] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<VerifyState>(emptyState);
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  function reset() { setError(""); setState(emptyState()); log.clear(); }

  async function loadFile(file: File) { reset(); setEnvelopeText(await readFileAsText(file)); }

  async function verify() {
    reset();
    const text = envelopeText.trim();
    if (!text) return setError("Paste envelope JSON or upload a file.");

    try {
      log.push("=== UniVerify verification ===");
      log.push(`registry=${REGISTRY} chainId=${TARGET_CHAIN_ID}`);

      const parsed = parseJson(text);
      if (!parsed.ok) throw new Error(parsed.error);
      const env: DiplomaEnvelope = validateDiplomaEnvelope(parsed.value);
      const parsedPayload = DiplomaPayloadSchema.safeParse(env.payload);

      const docHash = hashPayload(env.payload);
      const issuer = env.proof.issuer;
      const batchId = BigInt(env.proof.batchId);
      const proof = env.proof.proof;

      log.push(`docHash=${docHash}`);
      log.push(`issuer=${issuer} batchId=${batchId}`);

      const [statusCode, batch, issuerTrustedNow, issuerUniversityId, revoked] = await Promise.all([
        readStatusWithProof({ publicClient, registry: REGISTRY, docHash, issuer, batchId, proof }),
        readBatch({ publicClient, registry: REGISTRY, issuer, batchId }),
        readIsIssuer({ publicClient, registry: REGISTRY, issuer }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer }),
        readIsRevoked({ publicClient, registry: REGISTRY, docHash, issuer, batchId }),
      ]) as [0 | 1 | 2, { issuer: Address; merkleRoot: Hex }, boolean, bigint, boolean];

      const status = statusLabel(statusCode);
      const onChainBatchRoot = batch.merkleRoot;

      const leaf = computeMerkleLeaf({ registry: REGISTRY, chainId: BigInt(TARGET_CHAIN_ID), issuer, batchId, docHash });
      const computedRoot = computeRootFromProof({ leaf, proof });
      const merkleRootMatches = computedRoot.toLowerCase() === onChainBatchRoot.toLowerCase();

      const university = issuerUniversityId > 0n
        ? await readUniversityMeta({ publicClient, registry: REGISTRY, universityId: issuerUniversityId, fromBlock: DEPLOY_BLOCK })
        : null;

      const universityActive = university?.status === 1;
      const verifyOk = statusCode === 1 && merkleRootMatches && universityActive;

      log.push(`status=${statusCode} (${status}) | merkle=${merkleRootMatches ? "OK" : "FAIL"}`);
      log.push(`university=${university?.name ?? "N/A"} status=${university?.status ?? "N/A"}`);
      log.push(`RESULT=${verifyOk ? "VERIFIED" : "NOT VERIFIED"}`);

      setState({
        docHash,
        statusCode,
        statusLabel: status,
        batchId: Number(batchId),
        onChainBatchRoot,
        merkleLeaf: leaf,
        merkleComputedRoot: computedRoot,
        merkleRootMatches,
        recordRevoked: revoked,
        issuer,
        issuerTrustedNow,
        issuerUniversityId,
        universityName: university?.name ?? null,
        universityCountry: university?.country ?? null,
        universityWebsite: university?.website ?? null,
        universityStatus: university?.status ?? null,
        verifyOk,
        diplomaPayload: parsedPayload.success ? parsedPayload.data : null,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
      log.push(`ERROR=${msg}`);
      setState((prev) => ({ ...prev, verifyOk: false }));
    }
  }

  const failReasons = verificationFailures(state);

  return (
    <main className="uv-page">
      <h1 className="uv-title"><span className="uv-title-gradient">Verifier</span></h1>
      <p className="uv-subtitle">Verify a diploma envelope against the on-chain registry.</p>

      <div className="uv-card">
        <div className="uv-file-zone" style={{ marginBottom: 14 }}>
          <input type="file" accept="application/json" onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }} />
        </div>
        <label className="uv-label">Diploma envelope JSON</label>
        <textarea
          value={envelopeText}
          onChange={(e) => setEnvelopeText(e.target.value)}
          className="uv-input"
          rows={12}
          placeholder='{ "payload": { ... }, "proof": { "type": "MERKLE_BATCH", "batchId": 1, "issuer": "0x...", "proof": [...] } }'
          style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}
        />
        <div className="uv-actions">
          <button onClick={() => void verify()} className="uv-btn uv-btn-primary">Verify diploma</button>
          <button onClick={reset} className="uv-btn">Clear</button>
        </div>
      </div>

      {state.verifyOk !== null && (
        <div className={`uv-verify-result ${state.verifyOk ? "uv-verify-ok" : "uv-verify-fail"}`}>
          <div className="uv-verify-icon">
            {state.verifyOk ? "\u2713" : "\u2717"}
          </div>
          <div>
            <div style={{ fontWeight: 700, fontSize: 18 }}>
              {state.verifyOk ? "VERIFIED" : "NOT VERIFIED"}
            </div>
            {!state.verifyOk && failReasons.length > 0 && (
              <ul className="uv-list" style={{ marginTop: 6, fontSize: 13, color: "var(--muted)" }}>
                {failReasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            )}
          </div>
        </div>
      )}

      {error && <div className="uv-status-banner uv-status-fail"><b>Error:</b> {error}</div>}

      {state.verifyOk !== null && state.diplomaPayload !== null && (
        <div className="uv-card">
          <h2 className="uv-card-title">Diploma</h2>
          <div className="uv-kv">
            <b>Student</b><span>{state.diplomaPayload.student.firstName} {state.diplomaPayload.student.lastName}</span>
            <b>Student ID</b><span>{state.diplomaPayload.student.studentId}</span>
            <b>Degree</b><span>{state.diplomaPayload.degree.name}</span>
            <b>Level</b><span>{state.diplomaPayload.degree.level}</span>
            <b>Issued</b><span>{state.diplomaPayload.issuedAt}</span>
            <b>Diploma No.</b><span>{state.diplomaPayload.diplomaNumber}</span>
            {state.universityName && <><b>University</b><span>{state.universityName}</span></>}
          </div>
        </div>
      )}

      {state.verifyOk !== null && (
        <div className="uv-card">
          <h2 className="uv-card-title">Summary</h2>
          <div className="uv-kv">
            <b>Status</b><span>{state.statusLabel} ({state.statusCode})</span>
            <b>University</b><span>{state.universityName ?? "\u2014"}</span>
            <b>University status</b><span>{universityStatusLabel(state.universityStatus ?? 0)}</span>
            {state.universityCountry && <><b>Country</b><span>{state.universityCountry}</span></>}
            {state.universityWebsite && <><b>Website</b><a href={state.universityWebsite} target="_blank" rel="noopener noreferrer">{state.universityWebsite}</a></>}
            <b>Issuer</b><code>{state.issuer ?? "\u2014"}</code>
            <b>Issuer trusted</b><span>{state.issuerTrustedNow === null ? "\u2014" : state.issuerTrustedNow ? "Yes" : "No"}</span>
            <b>Batch ID</b><span>{state.batchId ?? "\u2014"}</span>
            <b>Revoked</b><span>{state.recordRevoked === null ? "\u2014" : String(state.recordRevoked)}</span>
          </div>
        </div>
      )}

      {state.verifyOk !== null && (
        <details className="uv-details">
          <summary>Technical details</summary>
          <div className="uv-kv" style={{ marginTop: 10 }}>
            <b>docHash</b><code>{state.docHash ?? "\u2014"}</code>
            <b>Batch root (on-chain)</b><code>{state.onChainBatchRoot ?? "\u2014"}</code>
            <b>Merkle leaf</b><code>{state.merkleLeaf ?? "\u2014"}</code>
            <b>Merkle root (local)</b><code>{state.merkleComputedRoot ?? "\u2014"}</code>
            <b>Merkle root match</b><span>{state.merkleRootMatches === null ? "\u2014" : state.merkleRootMatches ? "Yes" : "No"}</span>
            <b>Issuer university ID</b><span>{state.issuerUniversityId?.toString() ?? "\u2014"}</span>
          </div>
        </details>
      )}

      {logs.length > 0 && (
        <div className="uv-card uv-logs">
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
