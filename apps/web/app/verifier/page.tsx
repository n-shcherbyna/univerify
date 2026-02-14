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
  readStatusWithProof,
  statusLabel,
} from "@/lib/univerify/registry";
import { normalizeAddress, parseJson, validateDiplomaEnvelope } from "@/lib/univerify/json";
import { readFileAsText } from "@/lib/univerify/file";
import { recoverIssuerFromEip712 } from "@/lib/univerify/eip712";
import { makeStateLogger } from "@/lib/univerify/logs";
import { computeMerkleLeaf, computeRootFromProof } from "@/lib/univerify/merkle";

type VerifyState = {
  docHash: Hex | null;
  proofType: string;
  verificationMode: "batch";
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
  verifyOk: boolean | null;
};

function emptyState(): VerifyState {
  return {
    docHash: null,
    proofType: "-",
    verificationMode: "batch",
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
    verifyOk: null,
  };
}

export default function VerifyPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
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
    const text = await readFileAsText(file);
    setEnvelopeText(text);
  }

  async function verify() {
    reset();
    const text = envelopeText.trim();
    if (!text) return setError("Paste envelope JSON or upload a file first.");

    try {
      log.push("=== UniVerify verification (batch-only) ===");
      log.push(`config.registry=${REGISTRY}`);
      log.push(`config.chainId=${TARGET_CHAIN_ID}`);

      const parsed = parseJson(text);
      if (!parsed.ok) throw new Error(parsed.error);
      const env: DiplomaEnvelope = validateDiplomaEnvelope(parsed.value);
      log.push(`proof.type=${env.proof.type}`);

      const docHash = hashPayload(env.payload);
      log.push(`docHash(payload)=${docHash}`);

      let batchId: bigint;
      let batchProof: Hex[];
      let recoveredSigner: Address | null = null;
      let declaredIssuer: Address | null = null;
      let proofType: string = env.proof.type;

      if (env.proof.type === "MERKLE_BATCH") {
        batchId = BigInt(env.proof.batchId);
        batchProof = env.proof.proof;
        declaredIssuer = env.proof.issuer ?? null;
        log.push(`merkle.batchId=${env.proof.batchId}`);
        log.push(`merkle.proofNodes=${env.proof.proof.length}`);

        if (env.proof.eip712) {
          log.push("signature.mode=optional-eip712");
          if (normalizeAddress(env.proof.eip712.domain.verifyingContract) !== normalizeAddress(REGISTRY)) {
            throw new Error("Envelope eip712.verifyingContract does not match configured REGISTRY.");
          }
          recoveredSigner = await recoverIssuerFromEip712({
            docHash,
            signature: env.proof.eip712.signature,
            domain: env.proof.eip712.domain,
            types: env.proof.eip712.types,
          });
          log.push(`signature.recovered=${recoveredSigner}`);
        } else {
          log.push("signature.mode=none");
        }
      } else {
        if (!env.proof.merkle) {
          throw new Error("Single-record envelope is no longer supported. Provide MERKLE_BATCH proof.");
        }

        proofType = "EIP712+MERKLE";
        declaredIssuer = env.proof.issuer ?? null;
        log.push("signature.mode=legacy-eip712");
        if (normalizeAddress(env.proof.domain.verifyingContract) !== normalizeAddress(REGISTRY)) {
          throw new Error("Envelope verifyingContract does not match configured REGISTRY.");
        }
        recoveredSigner = await recoverIssuerFromEip712({
          docHash,
          signature: env.proof.signature,
          domain: env.proof.domain,
          types: env.proof.types,
        });
        log.push(`signature.recovered=${recoveredSigner}`);

        batchId = BigInt(env.proof.merkle.batchId);
        batchProof = env.proof.merkle.proof;
        log.push(`merkle.batchId=${env.proof.merkle.batchId}`);
        log.push(`merkle.proofNodes=${env.proof.merkle.proof.length}`);
      }

      if (declaredIssuer && recoveredSigner && normalizeAddress(declaredIssuer) !== normalizeAddress(recoveredSigner)) {
        throw new Error("Envelope issuer does not match EIP-712 recovered signer.");
      }
      const effectiveIssuer = declaredIssuer ?? recoveredSigner;
      if (!effectiveIssuer) {
        throw new Error("Missing issuer identity: provide proof.issuer or EIP-712 signature.");
      }

      const statusCode = (await readStatusWithProof({
        publicClient,
        registry: REGISTRY,
        docHash,
        issuer: effectiveIssuer,
        batchId,
        proof: batchProof,
      })) as 0 | 1 | 2;
      const status = statusLabel(statusCode);
      log.push(`chain.status=${statusCode} (${status})`);

      const batch = await readBatch({ publicClient, registry: REGISTRY, issuer: effectiveIssuer, batchId });
      const onChainBatchRoot = batch.merkleRoot;
      log.push(`batch.issuer=${batch.issuer}`);
      log.push(`batch.root.onchain=${batch.merkleRoot}`);

      const merkleLeaf = computeMerkleLeaf({
        registry: REGISTRY,
        chainId: BigInt(TARGET_CHAIN_ID),
        issuer: batch.issuer,
        batchId,
        docHash,
      });
      const merkleComputedRoot = computeRootFromProof({ leaf: merkleLeaf, proof: batchProof });
      const merkleRootMatches = merkleComputedRoot.toLowerCase() === onChainBatchRoot.toLowerCase();

      log.push(`merkle.leaf.local=${merkleLeaf}`);
      log.push(`merkle.root.localFromProof=${merkleComputedRoot}`);
      log.push(`merkle.root.matchesOnChain=${merkleRootMatches ? "YES" : "NO"}`);

      const issuerTrustedNow = await readIsIssuer({
        publicClient,
        registry: REGISTRY,
        issuer: effectiveIssuer,
      });
      log.push(`issuer.trustedNow=${issuerTrustedNow ? "YES" : "NO"}`);

      const revoked = await readIsRevoked({
        publicClient,
        registry: REGISTRY,
        docHash,
        issuer: effectiveIssuer,
        batchId,
      });
      log.push(`record.revoked=${revoked === null ? "UNAVAILABLE (old contract ABI)" : String(revoked)}`);

      const declaredIssuerOk = declaredIssuer
        ? normalizeAddress(declaredIssuer) === normalizeAddress(effectiveIssuer)
        : true;
      if (declaredIssuer) {
        log.push(`proof.issuer.declared=${declaredIssuer}`);
        log.push(`check.proofIssuerMatchesBatchIssuer=${declaredIssuerOk ? "OK" : "FAIL"}`);
      } else {
        log.push("check.proofIssuerMatchesBatchIssuer=SKIPPED (issuer not declared)");
      }

      const statusOk = statusCode === 1;
      const issuerOk = recoveredSigner ? normalizeAddress(recoveredSigner) === normalizeAddress(effectiveIssuer) : true;
      const merkleOk = merkleRootMatches;

      log.push(`check.statusValid=${statusOk ? "OK" : "FAIL"}`);
      log.push(`check.merkleRoot=${merkleOk ? "OK" : "FAIL"}`);
      if (recoveredSigner) log.push(`check.signatureIssuerMatch=${issuerOk ? "OK" : "FAIL"}`);
      else log.push("check.signatureIssuerMatch=SKIPPED (no signature)");

      const verifyOk = statusOk && issuerOk && merkleOk && declaredIssuerOk;
      log.push(`RESULT=${verifyOk ? "VERIFIED ✅" : "NOT VERIFIED ❌"}`);

      setState({
        docHash,
        proofType,
        verificationMode: "batch",
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
        verifyOk,
      });
    } catch (e: any) {
      setError(e?.message ?? String(e));
      log.push(`ERROR=${e?.message ?? String(e)}`);
      setState((prev) => ({ ...prev, verifyOk: false }));
    }
  }

  return (
    <main style={{ maxWidth: 960, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Verifier</h1>

      <div className="uv-card">
        <input
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void loadFile(f);
          }}
        />
      </div>

      <div className="uv-card">
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Envelope JSON</label>
        <textarea
          value={envelopeText}
          onChange={(e) => setEnvelopeText(e.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />
        <div className="uv-actions">
          <button onClick={() => void verify()} className="uv-btn uv-btn-primary">
            Verify
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {state.docHash && <p><b>docHash:</b> <code>{state.docHash}</code></p>}
        <p><b>proof type:</b> {state.proofType}</p>
        <p><b>verification mode:</b> {state.verificationMode}</p>
        <p><b>on-chain status:</b> {state.statusLabel} ({state.statusCode})</p>
        {state.batchId !== null && <p><b>batchId:</b> <code>{state.batchId}</code></p>}

        {state.effectiveIssuer && <p><b>batch issuer:</b> <code>{state.effectiveIssuer}</code></p>}
        {state.recoveredSigner && <p><b>recovered signer:</b> <code>{state.recoveredSigner}</code></p>}
        {state.recoveredSigner === null && <p><b>signature check:</b> skipped (no EIP-712 in envelope)</p>}
        {state.recordRevoked !== null && <p><b>revoked flag:</b> {String(state.recordRevoked)}</p>}
        {state.issuerTrustedNow !== null && <p><b>issuer trusted now:</b> {state.issuerTrustedNow ? "YES" : "NO"}</p>}

        {state.onChainBatchRoot && <p><b>batch root (on-chain):</b> <code>{state.onChainBatchRoot}</code></p>}
        {state.merkleLeaf && <p><b>merkle leaf (local):</b> <code>{state.merkleLeaf}</code></p>}
        {state.merkleComputedRoot && <p><b>merkle root from proof (local):</b> <code>{state.merkleComputedRoot}</code></p>}
        {state.merkleRootMatches !== null && <p><b>merkle root match:</b> {state.merkleRootMatches ? "YES" : "NO"}</p>}

        {error && <p style={{ color: "red" }}><b>Error:</b> {error}</p>}
        {state.verifyOk !== null && (
          <p style={{ color: state.verifyOk ? "green" : "red" }}>
            <b>Verification result:</b> {state.verifyOk ? "VERIFIED ✅" : "NOT VERIFIED ❌"}
          </p>
        )}

        {logs.length > 0 && (
          <div style={{ marginTop: 12, padding: 12, backgroundColor: "#f0f0f0", maxHeight: 360, overflowY: "auto" }}>
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
