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
  readStatusWithProof,
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
  payloadUniversityId: bigint | null;
  payloadUniversityName: string | null;
  issuerUniversityId: bigint | null;
  catalogSnapshotHash: Hex | null;
  catalogUniversityMetadataHash: Hex | null;
  catalogOfficialUniversityName: string | null;
  universityNameMatches: boolean | null;
  onChainUniversityMetadataHash: Hex | null;
  onChainUniversityStatus: number | null;
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
    payloadUniversityId: null,
    payloadUniversityName: null,
    issuerUniversityId: null,
    catalogSnapshotHash: null,
    catalogUniversityMetadataHash: null,
    catalogOfficialUniversityName: null,
    universityNameMatches: null,
    onChainUniversityMetadataHash: null,
    onChainUniversityStatus: null,
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
  if (typeof raw !== "string" || raw.trim() === "") {
    throw new Error("Payload missing university.name.");
  }
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
      log.push(`payload.university.name=${payloadUniversityName}`);

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

      const issuerUniversityId = await readIssuerUniversityId({
        publicClient,
        registry: REGISTRY,
        issuer: effectiveIssuer,
      });
      const universityIdOk = issuerUniversityId === payloadUniversityId;
      log.push(`issuer.universityId.onchain=${issuerUniversityId.toString()}`);
      log.push(`check.universityIdMatch=${universityIdOk ? "OK" : "FAIL"}`);

      const onChainUniversity = await readUniversity({
        publicClient,
        registry: REGISTRY,
        universityId: payloadUniversityId,
      });
      const onChainUniversityMetadataHash = onChainUniversity.metadataHash;
      const onChainUniversityStatus = onChainUniversity.status;
      const onChainUniversityActive = onChainUniversityStatus === 1;
      log.push(`university.metadataHash.onchain=${onChainUniversityMetadataHash}`);
      log.push(`university.status.onchain=${onChainUniversityStatus} (${onChainUniversityActive ? "Active" : "NotActive"})`);

      const onChainSnapshot = await readSnapshot({
        publicClient,
        registry: REGISTRY,
      });
      log.push(`snapshot.hash.onchain=${onChainSnapshot.hash}`);

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
        log.push(`snapshot.hash.catalog=${catalogSnapshotHash}`);

        const catalogSnapshotHashOk = catalogSnapshotHash.toLowerCase() === onChainSnapshot.hash.toLowerCase();
        log.push(`check.snapshotHashMatch=${catalogSnapshotHashOk ? "OK" : "FAIL"}`);

        const entry = catalog.universities.find((u) => BigInt(u.universityId) === payloadUniversityId);
        if (!entry) throw new Error(`Catalog missing universityId=${payloadUniversityId.toString()}.`);
        catalogUniversityMetadataHash = entry.metadataHash;
        catalogOfficialUniversityName = entry.officialName;
        log.push(`university.metadataHash.catalog=${catalogUniversityMetadataHash}`);
        log.push(`university.officialName.catalog=${catalogOfficialUniversityName}`);

        const metadataHashOk = catalogUniversityMetadataHash.toLowerCase() === onChainUniversityMetadataHash.toLowerCase();
        log.push(`check.universityMetadataHashMatch=${metadataHashOk ? "OK" : "FAIL"}`);

        const catalogName = entry.officialName.trim();
        universityNameMatches = payloadUniversityName.toLowerCase() === catalogName.toLowerCase();
        log.push(`check.universityNameMatch=${universityNameMatches ? "OK" : "FAIL"}`);

        catalogOk = catalogSnapshotHashOk && metadataHashOk && universityNameMatches;
      } else {
        log.push("check.catalog=SKIPPED (strict catalog disabled)");
      }

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
      const universityActiveOk = onChainUniversityActive;

      log.push(`check.statusValid=${statusOk ? "OK" : "FAIL"}`);
      log.push(`check.merkleRoot=${merkleOk ? "OK" : "FAIL"}`);
      log.push(`check.universityActive=${universityActiveOk ? "OK" : "FAIL"}`);
      if (recoveredSigner) log.push(`check.signatureIssuerMatch=${issuerOk ? "OK" : "FAIL"}`);
      else log.push("check.signatureIssuerMatch=SKIPPED (no signature)");

      const verifyOk = statusOk && issuerOk && merkleOk && declaredIssuerOk && universityIdOk && universityActiveOk && catalogOk;
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
        payloadUniversityId,
        payloadUniversityName,
        issuerUniversityId,
        catalogSnapshotHash,
        catalogUniversityMetadataHash,
        catalogOfficialUniversityName,
        universityNameMatches,
        onChainUniversityMetadataHash,
        onChainUniversityStatus,
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
        <label style={{ display: "inline-flex", alignItems: "center", gap: 8, fontWeight: 600 }}>
          <input
            type="checkbox"
            checked={strictCatalog}
            onChange={(e) => setStrictCatalog(e.target.checked)}
          />
          Strict catalog mode (snapshot hash + university metadata validation)
        </label>
        <p style={{ marginTop: 10, marginBottom: 0 }}>
          <b>Catalog file:</b> {catalogFileName ?? DEFAULT_CATALOG_PATH}
        </p>
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
        {state.payloadUniversityId !== null && <p><b>payload universityId:</b> {state.payloadUniversityId.toString()}</p>}
        {state.payloadUniversityName && <p><b>payload university name:</b> {state.payloadUniversityName}</p>}
        {state.issuerUniversityId !== null && <p><b>issuer universityId (on-chain):</b> {state.issuerUniversityId.toString()}</p>}
        {state.onChainUniversityStatus !== null && <p><b>university status (on-chain):</b> {state.onChainUniversityStatus}</p>}
        {state.onChainUniversityMetadataHash && <p><b>university metadata hash (on-chain):</b> <code>{state.onChainUniversityMetadataHash}</code></p>}
        {state.catalogUniversityMetadataHash && <p><b>university metadata hash (catalog):</b> <code>{state.catalogUniversityMetadataHash}</code></p>}
        {state.catalogOfficialUniversityName && <p><b>official university name (catalog):</b> {state.catalogOfficialUniversityName}</p>}
        {state.universityNameMatches !== null && <p><b>university name match:</b> {state.universityNameMatches ? "YES" : "NO"}</p>}
        {state.catalogSnapshotHash && <p><b>catalog snapshot hash:</b> <code>{state.catalogSnapshotHash}</code></p>}

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
