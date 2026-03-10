"use client";

import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import type { DiplomaEnvelope } from "@/lib/univerify/types";
import {
  makePublicClient,
  readBatch,
  readIsIssuer,
  readIsRevoked,
  readIssuerUniversityId,
  readStatusWithProofTrusted,
  readUniversityMeta,
  statusLabel,
  universityStatusLabel,
} from "@/lib/univerify/registry";
import { normalizeAddress, parseJson, validateDiplomaEnvelope } from "@/lib/univerify/json";
import { readFileAsText } from "@/lib/univerify/file";
import { recoverIssuerFromEip712 } from "@/lib/univerify/eip712";
import { makeStateLogger } from "@/lib/univerify/logs";
import { computeMerkleLeaf, computeRootFromProof } from "@/lib/univerify/merkle";

type VerifyState = {
  docHash: Hex | null;
  proofType: string;
  statusCode: 0 | 1 | 2;
  statusLabel: "Unknown" | "Valid" | "Revoked";
  batchId: number | null;
  onChainBatchRoot: Hex | null;
  merkleLeaf: Hex | null;
  merkleComputedRoot: Hex | null;
  merkleRootMatches: boolean | null;
  recordRevoked: boolean | null;
  effectiveIssuer: Address | null;
  recoveredSigner: Address | null;
  issuerTrustedNow: boolean | null;
  issuerUniversityId: bigint | null;
  universityName: string | null;
  universityCountry: string | null;
  universityWebsite: string | null;
  universityStatus: number | null;
  declaredIssuerMatches: boolean | null;
  signatureIssuerMatches: boolean | null;
  verifyOk: boolean | null;
};

function emptyState(): VerifyState {
  return {
    docHash: null,
    proofType: "-",
    statusCode: 0,
    statusLabel: "Unknown",
    batchId: null,
    onChainBatchRoot: null,
    merkleLeaf: null,
    merkleComputedRoot: null,
    merkleRootMatches: null,
    recordRevoked: null,
    effectiveIssuer: null,
    recoveredSigner: null,
    issuerTrustedNow: null,
    issuerUniversityId: null,
    universityName: null,
    universityCountry: null,
    universityWebsite: null,
    universityStatus: null,
    declaredIssuerMatches: null,
    signatureIssuerMatches: null,
    verifyOk: null,
  };
}

function verificationFailures(state: VerifyState): string[] {
  if (state.verifyOk !== false) return [];
  const reasons: string[] = [];
  if (state.statusCode !== 1) reasons.push(`On-chain status is ${state.statusLabel} (${state.statusCode}).`);
  if (state.merkleRootMatches === false) reasons.push("Merkle proof does not match on-chain batch root.");
  if (state.issuerTrustedNow === false) reasons.push("Issuer is not currently trusted on-chain.");
  if (state.universityStatus !== null && state.universityStatus !== 1) reasons.push("University is not active on-chain.");
  if (state.declaredIssuerMatches === false) reasons.push("Declared issuer does not match effective issuer.");
  if (state.signatureIssuerMatches === false) reasons.push("EIP-712 signature signer does not match issuer.");
  if (reasons.length === 0) reasons.push("Validation failed due to an internal consistency check.");
  return reasons;
}

export default function VerifyPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID, deployBlock: DEPLOY_BLOCK } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [envelopeText, setEnvelopeText] = useState("");
  const [error, setError] = useState("");
  const [state, setState] = useState<VerifyState>(emptyState);
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  function reset() {
    setError("");
    setState(emptyState());
    log.clear();
  }

  async function loadFile(file: File) {
    reset();
    setEnvelopeText(await readFileAsText(file));
  }

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

      const docHash = hashPayload(env.payload);
      log.push(`docHash=${docHash}`);

      let batchId: bigint;
      let batchProof: Hex[];
      let recoveredSigner: Address | null = null;
      let declaredIssuer: Address | null = null;
      const proofType: string = env.proof.type;

      if (env.proof.type === "MERKLE_BATCH") {
        batchId = BigInt(env.proof.batchId);
        batchProof = env.proof.proof;
        declaredIssuer = env.proof.issuer ?? null;
        if (env.proof.eip712) {
          if (normalizeAddress(env.proof.eip712.domain.verifyingContract) !== normalizeAddress(REGISTRY)) {
            throw new Error("EIP-712 verifyingContract does not match configured registry.");
          }
          recoveredSigner = await recoverIssuerFromEip712({
            docHash,
            signature: env.proof.eip712.signature,
            domain: env.proof.eip712.domain,
            types: env.proof.eip712.types,
          });
          log.push(`eip712.recovered=${recoveredSigner}`);
        }
      } else {
        if (!env.proof.merkle) throw new Error("Single-record EIP-712 envelope is no longer supported. Use MERKLE_BATCH.");
        declaredIssuer = env.proof.issuer ?? null;
        if (normalizeAddress(env.proof.domain.verifyingContract) !== normalizeAddress(REGISTRY)) {
          throw new Error("EIP-712 verifyingContract does not match configured registry.");
        }
        recoveredSigner = await recoverIssuerFromEip712({
          docHash,
          signature: env.proof.signature,
          domain: env.proof.domain,
          types: env.proof.types,
        });
        batchId = BigInt(env.proof.merkle.batchId);
        batchProof = env.proof.merkle.proof;
      }

      if (declaredIssuer && recoveredSigner && normalizeAddress(declaredIssuer) !== normalizeAddress(recoveredSigner)) {
        throw new Error("Declared issuer does not match EIP-712 recovered signer.");
      }

      const effectiveIssuer = declaredIssuer ?? recoveredSigner;
      if (!effectiveIssuer) throw new Error("Missing issuer: provide proof.issuer or EIP-712 signature.");

      const [statusCode, batch, issuerTrustedNow, issuerUniversityId, revoked] = await Promise.all([
        readStatusWithProofTrusted({ publicClient, registry: REGISTRY, docHash, issuer: effectiveIssuer, batchId, proof: batchProof }),
        readBatch({ publicClient, registry: REGISTRY, issuer: effectiveIssuer, batchId }),
        readIsIssuer({ publicClient, registry: REGISTRY, issuer: effectiveIssuer }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer: effectiveIssuer }),
        readIsRevoked({ publicClient, registry: REGISTRY, docHash, issuer: effectiveIssuer, batchId }),
      ]) as [0 | 1 | 2, { issuer: Address; merkleRoot: Hex }, boolean, bigint, boolean];

      const status = statusLabel(statusCode);
      const onChainBatchRoot = batch.merkleRoot;

      const merkleLeaf = computeMerkleLeaf({
        registry: REGISTRY,
        chainId: BigInt(TARGET_CHAIN_ID),
        issuer: effectiveIssuer,
        batchId,
        docHash,
      });
      const merkleComputedRoot = computeRootFromProof({ leaf: merkleLeaf, proof: batchProof });
      const merkleRootMatches = merkleComputedRoot.toLowerCase() === onChainBatchRoot.toLowerCase();

      const university = issuerUniversityId > 0n
        ? await readUniversityMeta({ publicClient, registry: REGISTRY, universityId: issuerUniversityId, fromBlock: DEPLOY_BLOCK })
        : null;

      const universityActive = university?.status === 1;
      const declaredIssuerOk = declaredIssuer ? normalizeAddress(declaredIssuer) === normalizeAddress(effectiveIssuer) : true;
      const signatureIssuerOk = recoveredSigner ? normalizeAddress(recoveredSigner) === normalizeAddress(effectiveIssuer) : true;

      const verifyOk = statusCode === 1 && merkleRootMatches && declaredIssuerOk && signatureIssuerOk && universityActive;

      log.push(`status=${statusCode} (${status})`);
      log.push(`issuer.trusted=${issuerTrustedNow}`);
      log.push(`university=${university?.name ?? "N/A"} status=${university?.status ?? "N/A"}`);
      log.push(`merkle=${merkleRootMatches ? "OK" : "FAIL"}`);
      log.push(`RESULT=${verifyOk ? "VERIFIED ✅" : "NOT VERIFIED ❌"}`);

      setState({
        docHash,
        proofType,
        statusCode,
        statusLabel: status,
        batchId: Number(batchId),
        onChainBatchRoot,
        merkleLeaf,
        merkleComputedRoot,
        merkleRootMatches,
        recordRevoked: revoked,
        effectiveIssuer,
        recoveredSigner,
        issuerTrustedNow,
        issuerUniversityId,
        universityName: university?.name ?? null,
        universityCountry: university?.country ?? null,
        universityWebsite: university?.website ?? null,
        universityStatus: university?.status ?? null,
        declaredIssuerMatches: declaredIssuerOk,
        signatureIssuerMatches: recoveredSigner ? signatureIssuerOk : null,
        verifyOk,
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      log.push(`ERROR=${e?.message ?? String(e)}`);
      setState((prev) => ({ ...prev, verifyOk: false }));
    }
  }

  const failReasons = verificationFailures(state);

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify — Verifier</h1>
      <p className="uv-subtitle">Verify a diploma envelope against the on-chain registry.</p>

      <div className="uv-card">
        <div className="uv-actions" style={{ marginTop: 0 }}>
          <input
            type="file"
            accept="application/json"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void loadFile(f); }}
          />
        </div>
        <label style={{ display: "block", fontWeight: 600, margin: "12px 0 6px" }}>Diploma envelope JSON</label>
        <textarea
          value={envelopeText}
          onChange={(e) => setEnvelopeText(e.target.value)}
          rows={12}
          placeholder='{ "payload": { ... }, "proof": { "type": "MERKLE_BATCH", ... } }'
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />
        <div className="uv-actions">
          <button onClick={() => void verify()} className="uv-btn uv-btn-primary">Verify diploma</button>
          <button onClick={reset} className="uv-btn">Clear</button>
        </div>
      </div>

      {state.verifyOk !== null && (
        <div className={`uv-status-banner ${state.verifyOk ? "uv-status-ok" : "uv-status-fail"}`}>
          <b style={{ fontSize: 16 }}>{state.verifyOk ? "✓ VERIFIED" : "✗ NOT VERIFIED"}</b>
          {!state.verifyOk && failReasons.length > 0 && (
            <ul className="uv-list">
              {failReasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="uv-status-banner uv-status-fail">
          <b>Error:</b> {error}
        </div>
      )}

      {state.verifyOk !== null && (
        <div className="uv-card">
          <h2 className="uv-card-title">Summary</h2>
          <div className="uv-kv">
            <b>Status</b><span>{state.statusLabel} ({state.statusCode})</span>
            <b>University</b><span>{state.universityName ?? "-"}</span>
            <b>University status</b><span>{universityStatusLabel(state.universityStatus ?? 0)}</span>
            {state.universityCountry && <><b>Country</b><span>{state.universityCountry}</span></>}
            {state.universityWebsite && <><b>Website</b><a href={state.universityWebsite} target="_blank" rel="noopener noreferrer">{state.universityWebsite}</a></>}
            <b>Issuer</b><code>{state.effectiveIssuer ?? "-"}</code>
            <b>Issuer trusted</b><span>{state.issuerTrustedNow === null ? "-" : state.issuerTrustedNow ? "YES" : "NO"}</span>
            <b>Batch ID</b><span>{state.batchId ?? "-"}</span>
            <b>Revoked</b><span>{state.recordRevoked === null ? "-" : String(state.recordRevoked)}</span>
            <b>Proof type</b><span>{state.proofType}</span>
          </div>
        </div>
      )}

      {state.verifyOk !== null && (
        <details className="uv-details">
          <summary>Technical details</summary>
          <div className="uv-kv" style={{ marginTop: 8 }}>
            <b>docHash</b><code>{state.docHash ?? "-"}</code>
            <b>Batch root (on-chain)</b><code>{state.onChainBatchRoot ?? "-"}</code>
            <b>Merkle leaf</b><code>{state.merkleLeaf ?? "-"}</code>
            <b>Merkle root (local)</b><code>{state.merkleComputedRoot ?? "-"}</code>
            <b>Merkle root match</b><span>{state.merkleRootMatches === null ? "-" : state.merkleRootMatches ? "YES" : "NO"}</span>
            <b>Issuer university ID</b><span>{state.issuerUniversityId?.toString() ?? "-"}</span>
            {state.recoveredSigner && <><b>EIP-712 signer</b><code>{state.recoveredSigner}</code></>}
          </div>
        </details>
      )}

      {logs.length > 0 && (
        <div className="uv-card" style={{ maxHeight: 320, overflowY: "auto" }}>
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
