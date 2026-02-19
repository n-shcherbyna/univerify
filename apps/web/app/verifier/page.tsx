"use client";

import { useEffect, useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import type { DiplomaEnvelope } from "@/lib/univerify/types";
import {
  makePublicClient,
  readBatch,
  readIsIssuer,
  readIssuerUniversityId,
  readIsRevoked,
  readSnapshot,
  readStatusWithProofTrusted,
  readUniversity,
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
  payloadUniversityId: bigint | null;
  payloadUniversityName: string | null;
  issuerUniversityId: bigint | null;
  onChainUniversityMetadataHash: Hex | null;
  onChainUniversityStatus: number | null;
  onChainSnapshotHash: Hex | null;
  catalogSnapshotHash: Hex | null;
  catalogUniversityMetadataHash: Hex | null;
  catalogOfficialUniversityName: string | null;
  universityNameMatches: boolean | null;
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
    payloadUniversityId: null,
    payloadUniversityName: null,
    issuerUniversityId: null,
    onChainUniversityMetadataHash: null,
    onChainUniversityStatus: null,
    onChainSnapshotHash: null,
    catalogSnapshotHash: null,
    catalogUniversityMetadataHash: null,
    catalogOfficialUniversityName: null,
    universityNameMatches: null,
    declaredIssuerMatches: null,
    signatureIssuerMatches: null,
    verifyOk: null,
  };
}

function readPayloadUniversityId(payload: unknown): bigint {
  const p = payload as any;
  const raw = p?.universityId ?? p?.university?.id;
  if (typeof raw === "number" && Number.isInteger(raw) && raw > 0) return BigInt(raw);
  if (typeof raw === "string" && /^\d+$/.test(raw) && raw !== "0") return BigInt(raw);
  throw new Error("Payload missing valid universityId (expected positive integer).");
}

function readPayloadUniversityName(payload: unknown): string {
  const p = payload as any;
  const raw = p?.university?.name;
  if (typeof raw !== "string" || raw.trim() === "") throw new Error("Payload missing university.name.");
  return raw.trim();
}

type CatalogEntry = {
  universityId: number;
  officialName: string;
  metadataHash: Hex;
};

type CatalogSnapshot = {
  universities: CatalogEntry[];
};

function parseCatalogSnapshot(text: string): CatalogSnapshot {
  const parsed = parseJson(text);
  if (!parsed.ok) throw new Error(`Catalog JSON invalid: ${parsed.error}`);
  const v = parsed.value as any;
  if (!v || typeof v !== "object") throw new Error("Catalog must be an object.");
  if (!Array.isArray(v.universities)) throw new Error("Catalog.universities must be an array.");

  for (const u of v.universities) {
    if (!Number.isInteger(u?.universityId) || u.universityId <= 0) {
      throw new Error("Each catalog university must have positive integer universityId.");
    }
    if (typeof u?.officialName !== "string" || u.officialName.trim() === "") {
      throw new Error("Each catalog university must have officialName.");
    }
    if (typeof u?.metadataHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(u.metadataHash)) {
      throw new Error("Each catalog university must have metadataHash bytes32.");
    }
  }

  return v as CatalogSnapshot;
}

function verificationFailures(state: VerifyState, strictCatalog: boolean): string[] {
  if (state.verifyOk !== false) return [];
  const reasons: string[] = [];

  if (state.statusCode !== 1) reasons.push(`On-chain trusted status is ${state.statusLabel} (${state.statusCode}).`);
  if (state.declaredIssuerMatches === false) reasons.push("Declared issuer in proof does not match effective issuer.");
  if (state.signatureIssuerMatches === false) reasons.push("Recovered signature signer does not match issuer.");
  if (state.merkleRootMatches === false) reasons.push("Merkle proof does not match on-chain batch root.");
  if (state.issuerTrustedNow === false) reasons.push("Issuer is not trusted on-chain.");
  if (state.issuerUniversityId !== null && state.payloadUniversityId !== null && state.issuerUniversityId !== state.payloadUniversityId) {
    reasons.push("Issuer universityId differs from diploma payload universityId.");
  }
  if (state.onChainUniversityStatus !== null && state.onChainUniversityStatus !== 1) {
    reasons.push("University is not active on-chain.");
  }
  if (strictCatalog) {
    if (state.catalogSnapshotHash && state.onChainSnapshotHash && state.catalogSnapshotHash.toLowerCase() !== state.onChainSnapshotHash.toLowerCase()) {
      reasons.push("Catalog snapshot hash does not match on-chain snapshot hash.");
    }
    if (
      state.catalogUniversityMetadataHash &&
      state.onChainUniversityMetadataHash &&
      state.catalogUniversityMetadataHash.toLowerCase() !== state.onChainUniversityMetadataHash.toLowerCase()
    ) {
      reasons.push("Catalog university metadata hash does not match on-chain metadata hash.");
    }
    if (state.universityNameMatches === false) reasons.push("Payload university name does not match catalog official name.");
  }

  if (reasons.length === 0) reasons.push("Validation failed due to an internal consistency check.");
  return reasons;
}

function universityStatusLabel(status: number | null): string {
  if (status === 1) return "Active";
  if (status === 2) return "Suspended";
  if (status === 3) return "Revoked";
  return "Unknown";
}

export default function VerifyPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);
  const DEFAULT_CATALOG_PATH = "/catalog.snapshot.json";

  const [envelopeText, setEnvelopeText] = useState("");
  const [catalogFileText, setCatalogFileText] = useState("");
  const [catalogFileName, setCatalogFileName] = useState<string | null>(null);
  const [strictCatalog, setStrictCatalog] = useState(true);
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

  useEffect(() => {
    let active = true;
    async function loadDefaultCatalog() {
      try {
        const res = await fetch(DEFAULT_CATALOG_PATH, { cache: "no-store" });
        if (!res.ok) throw new Error(`Failed to load ${DEFAULT_CATALOG_PATH} (${res.status}).`);
        const text = await res.text();
        parseCatalogSnapshot(text);
        if (!active) return;
        setCatalogFileText(text);
        setCatalogFileName(DEFAULT_CATALOG_PATH);
      } catch (e: any) {
        if (!active) return;
        setCatalogFileText("");
        setCatalogFileName(null);
        setError(e?.message ?? String(e));
      }
    }
    void loadDefaultCatalog();
    return () => {
      active = false;
    };
  }, []);

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
      const payloadUniversityId = readPayloadUniversityId(env.payload);
      const payloadUniversityName = readPayloadUniversityName(env.payload);
      log.push(`docHash(payload)=${docHash}`);
      log.push(`payload.universityId=${payloadUniversityId.toString()}`);

      let batchId: bigint;
      let batchProof: Hex[];
      let recoveredSigner: Address | null = null;
      let declaredIssuer: Address | null = null;
      let proofType: string = env.proof.type;

      if (env.proof.type === "MERKLE_BATCH") {
        batchId = BigInt(env.proof.batchId);
        batchProof = env.proof.proof;
        declaredIssuer = env.proof.issuer ?? null;

        if (env.proof.eip712) {
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
        }
      } else {
        if (!env.proof.merkle) {
          throw new Error("Single-record envelope is no longer supported. Provide MERKLE_BATCH proof.");
        }

        proofType = "EIP712+MERKLE";
        declaredIssuer = env.proof.issuer ?? null;
        if (normalizeAddress(env.proof.domain.verifyingContract) !== normalizeAddress(REGISTRY)) {
          throw new Error("Envelope verifyingContract does not match configured REGISTRY.");
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
        throw new Error("Envelope issuer does not match EIP-712 recovered signer.");
      }

      const effectiveIssuer = declaredIssuer ?? recoveredSigner;
      if (!effectiveIssuer) {
        throw new Error("Missing issuer identity: provide proof.issuer or EIP-712 signature.");
      }

      const statusCode = (await readStatusWithProofTrusted({
        publicClient,
        registry: REGISTRY,
        docHash,
        issuer: effectiveIssuer,
        batchId,
        proof: batchProof,
      })) as 0 | 1 | 2;
      const status = statusLabel(statusCode);

      const batch = await readBatch({ publicClient, registry: REGISTRY, issuer: effectiveIssuer, batchId });
      const onChainBatchRoot = batch.merkleRoot;

      const merkleLeaf = computeMerkleLeaf({
        registry: REGISTRY,
        chainId: BigInt(TARGET_CHAIN_ID),
        issuer: batch.issuer,
        batchId,
        docHash,
      });
      const merkleComputedRoot = computeRootFromProof({ leaf: merkleLeaf, proof: batchProof });
      const merkleRootMatches = merkleComputedRoot.toLowerCase() === onChainBatchRoot.toLowerCase();

      const [issuerTrustedNow, issuerUniversityId, onChainUniversity, onChainSnapshot, revoked] = await Promise.all([
        readIsIssuer({ publicClient, registry: REGISTRY, issuer: effectiveIssuer }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer: effectiveIssuer }),
        readUniversity({ publicClient, registry: REGISTRY, universityId: payloadUniversityId }),
        readSnapshot({ publicClient, registry: REGISTRY }),
        readIsRevoked({ publicClient, registry: REGISTRY, docHash, issuer: effectiveIssuer, batchId }),
      ]);

      const onChainUniversityMetadataHash = onChainUniversity.metadataHash;
      const onChainUniversityStatus = onChainUniversity.status;
      const onChainUniversityActive = onChainUniversityStatus === 1;

      let catalogSnapshotHash: Hex | null = null;
      let catalogUniversityMetadataHash: Hex | null = null;
      let catalogOfficialUniversityName: string | null = null;
      let universityNameMatches: boolean | null = null;
      let catalogOk = true;

      if (strictCatalog) {
        const rawCatalog = catalogFileText.trim();
        if (!rawCatalog) throw new Error(`Strict catalog is enabled. Missing default catalog: ${DEFAULT_CATALOG_PATH}.`);
        log.push(`catalog.source=${catalogFileName ?? DEFAULT_CATALOG_PATH}`);

        const catalog = parseCatalogSnapshot(rawCatalog);
        catalogSnapshotHash = hashPayload(catalog) as Hex;

        const entry = catalog.universities.find((u) => BigInt(u.universityId) === payloadUniversityId);
        if (!entry) throw new Error(`Catalog missing universityId=${payloadUniversityId.toString()}.`);
        catalogUniversityMetadataHash = entry.metadataHash;
        catalogOfficialUniversityName = entry.officialName;

        universityNameMatches = payloadUniversityName.toLowerCase() === entry.officialName.trim().toLowerCase();
        const snapshotMatch = catalogSnapshotHash.toLowerCase() === onChainSnapshot.hash.toLowerCase();
        const metadataMatch = catalogUniversityMetadataHash.toLowerCase() === onChainUniversityMetadataHash.toLowerCase();
        catalogOk = snapshotMatch && metadataMatch && !!universityNameMatches;
      }

      const declaredIssuerOk = declaredIssuer
        ? normalizeAddress(declaredIssuer) === normalizeAddress(effectiveIssuer)
        : true;
      const signatureIssuerOk = recoveredSigner
        ? normalizeAddress(recoveredSigner) === normalizeAddress(effectiveIssuer)
        : true;
      const universityIdOk = issuerUniversityId === payloadUniversityId;

      const verifyOk =
        statusCode === 1 &&
        merkleRootMatches &&
        declaredIssuerOk &&
        signatureIssuerOk &&
        universityIdOk &&
        onChainUniversityActive &&
        catalogOk;

      log.push(`chain.status.trusted=${statusCode} (${status})`);
      log.push(`issuer.trustedNow=${issuerTrustedNow ? "YES" : "NO"}`);
      log.push(`check.universityIdMatch=${universityIdOk ? "OK" : "FAIL"}`);
      log.push(`check.merkleRoot=${merkleRootMatches ? "OK" : "FAIL"}`);
      log.push(`check.universityActive=${onChainUniversityActive ? "OK" : "FAIL"}`);
      log.push(`check.catalog=${strictCatalog ? (catalogOk ? "OK" : "FAIL") : "SKIPPED"}`);
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
        payloadUniversityId,
        payloadUniversityName,
        issuerUniversityId,
        onChainUniversityMetadataHash,
        onChainUniversityStatus,
        onChainSnapshotHash: onChainSnapshot.hash,
        catalogSnapshotHash,
        catalogUniversityMetadataHash,
        catalogOfficialUniversityName,
        universityNameMatches,
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

  const failReasons = verificationFailures(state, strictCatalog);

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify - Verifier</h1>
      <p className="uv-subtitle">Result is based on strict on-chain trust semantics. Logs stay available for diagnostics.</p>

      <div className="uv-card">
        <div className="uv-actions" style={{ marginTop: 0 }}>
          <input
            type="file"
            accept="application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void loadFile(f);
            }}
          />
          <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
            <input type="checkbox" checked={strictCatalog} onChange={(e) => setStrictCatalog(e.target.checked)} />
            Strict catalog mode
          </label>
        </div>
        <p className="uv-hint"><b>Catalog file:</b> {catalogFileName ?? DEFAULT_CATALOG_PATH}</p>

        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Envelope JSON</label>
        <textarea
          value={envelopeText}
          onChange={(e) => setEnvelopeText(e.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />
        <div className="uv-actions">
          <button onClick={() => void verify()} className="uv-btn uv-btn-primary">Verify</button>
        </div>
      </div>

      {state.verifyOk !== null && (
        <div className={`uv-status-banner ${state.verifyOk ? "uv-status-ok" : "uv-status-fail"}`}>
          <b>Verification result:</b> {state.verifyOk ? "VERIFIED" : "NOT VERIFIED"}
          {state.verifyOk === false && failReasons.length > 0 && (
            <ul className="uv-list">
              {failReasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && (
        <div className="uv-status-banner uv-status-fail">
          <b>Error:</b> {error}
        </div>
      )}

      <div className="uv-card">
        <h2 className="uv-card-title">Summary</h2>
        <div className="uv-kv">
          <b>Proof type</b><span>{state.proofType}</span>
          <b>On-chain status</b><span>{state.statusLabel} ({state.statusCode})</span>
          <b>Batch ID</b><span>{state.batchId ?? "-"}</span>
          <b>Issuer</b><span><code>{state.effectiveIssuer ?? "-"}</code></span>
          <b>Issuer trusted now</b><span>{state.issuerTrustedNow === null ? "-" : state.issuerTrustedNow ? "YES" : "NO"}</span>
          <b>University status</b><span>{universityStatusLabel(state.onChainUniversityStatus)}</span>
          <b>Revoked flag</b><span>{state.recordRevoked === null ? "UNAVAILABLE" : String(state.recordRevoked)}</span>
        </div>
      </div>

      <details className="uv-details">
        <summary>Technical details</summary>
        <div className="uv-kv">
          <b>docHash</b><code>{state.docHash ?? "-"}</code>
          <b>Merkle root match</b><span>{state.merkleRootMatches === null ? "-" : state.merkleRootMatches ? "YES" : "NO"}</span>
          <b>Batch root on-chain</b><code>{state.onChainBatchRoot ?? "-"}</code>
          <b>Merkle leaf local</b><code>{state.merkleLeaf ?? "-"}</code>
          <b>Merkle root local</b><code>{state.merkleComputedRoot ?? "-"}</code>
          <b>Payload universityId</b><span>{state.payloadUniversityId?.toString() ?? "-"}</span>
          <b>Issuer universityId</b><span>{state.issuerUniversityId?.toString() ?? "-"}</span>
          <b>University name match</b><span>{state.universityNameMatches === null ? "-" : state.universityNameMatches ? "YES" : "NO"}</span>
          <b>Snapshot on-chain</b><code>{state.onChainSnapshotHash ?? "-"}</code>
          <b>Snapshot catalog</b><code>{state.catalogSnapshotHash ?? "-"}</code>
          <b>Metadata on-chain</b><code>{state.onChainUniversityMetadataHash ?? "-"}</code>
          <b>Metadata catalog</b><code>{state.catalogUniversityMetadataHash ?? "-"}</code>
        </div>
      </details>

      {logs.length > 0 && (
        <div className="uv-card" style={{ maxHeight: 360, overflowY: "auto" }}>
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
    </main>
  );
}
