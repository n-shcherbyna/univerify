"use client";

import { useMemo, useState } from "react";
import type { Address, Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import type { DiplomaEnvelopeEip712 } from "@/lib/univerify/types";
import {
  makePublicClient,
  readRecord,
  readStatus,
  statusLabel,
  readIsIssuer,
} from "@/lib/univerify/registry";
import {
  parseJson,
  validateEip712Envelope,
  normalizeAddress,
} from "@/lib/univerify/json";
import { readFileAsText } from "@/lib/univerify/file";
import { recoverIssuerFromEip712 } from "@/lib/univerify/eip712";
import { makeStateLogger } from "@/lib/univerify/logs";

export default function VerifyPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [envelopeText, setEnvelopeText] = useState("");

  const [docHash, setDocHash] = useState<Hex | null>(null);
  const [recovered, setRecovered] = useState<Address | null>(null);

  const [onChainStatus, setOnChainStatus] = useState("");
  const [onChainIssuer, setOnChainIssuer] = useState<Address | null>(null);
  const [onChainRevoked, setOnChainRevoked] = useState<boolean | null>(null);

  const [issuerTrustedNow, setIssuerTrustedNow] = useState<boolean | null>(null);

  const [verifyOk, setVerifyOk] = useState<boolean | null>(null);
  const [error, setError] = useState("");

  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  function reset() {
    setError("");
    setVerifyOk(null);

    setDocHash(null);
    setRecovered(null);

    setOnChainStatus("");
    setOnChainIssuer(null);
    setOnChainRevoked(null);
    setIssuerTrustedNow(null);

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
      log.push("=== UniVerify verifier (EIP-712) ===");
      log.push(`registry(env): ${REGISTRY}`);

      const parsed = parseJson(text);
      if (!parsed.ok) throw new Error(parsed.error);

      const env: DiplomaEnvelopeEip712 = validateEip712Envelope(parsed.value);

      log.push(`proof.type: ${env.proof.type}`);
      log.push(`domain.name: ${env.proof.domain.name}`);
      log.push(`domain.version: ${env.proof.domain.version}`);
      log.push(`domain.chainId: ${env.proof.domain.chainId}`);
      log.push(`domain.verifyingContract: ${env.proof.domain.verifyingContract}`);
      log.push(`signature: ${env.proof.signature}`);

      // Strict contract binding: ensure the envelope targets THIS registry.
      if (normalizeAddress(env.proof.domain.verifyingContract) !== normalizeAddress(REGISTRY)) {
        throw new Error("Envelope verifyingContract does not match configured REGISTRY.");
      }

      // 1) docHash(payload)
      const h = hashPayload(env.payload);
      setDocHash(h);
      log.push(`docHash(payload): ${h}`);

      // 2) recover signer from typed-data signature
      const recSigner = await recoverIssuerFromEip712({
        docHash: h,
        signature: env.proof.signature,
        domain: env.proof.domain,
        types: env.proof.types,
      });
      setRecovered(recSigner);
      log.push(`recovered signer: ${recSigner}`);

      // 3) on-chain record
      const code = await readStatus({ publicClient, registry: REGISTRY, docHash: h });
      const label = statusLabel(code);
      setOnChainStatus(label);
      log.push(`on-chain status: ${code} (${label})`);

      const r = await readRecord({ publicClient, registry: REGISTRY, docHash: h });
      setOnChainIssuer(r.issuer);
      setOnChainRevoked(r.revoked);

      log.push(`on-chain issuer: ${r.issuer}`);
      log.push(`on-chain revoked: ${String(r.revoked)}`);

      const trustedNow = await readIsIssuer({ publicClient, registry: REGISTRY, issuer: r.issuer });
      setIssuerTrustedNow(trustedNow);
      log.push(`issuer trusted now (isIssuer): ${trustedNow ? "YES" : "NO"}`);

      // 4) checks
      const statusOk = code === 1;
      const issuerOk = normalizeAddress(recSigner) === normalizeAddress(r.issuer);

      log.push(`check: status == Valid -> ${statusOk ? "OK" : "FAIL"}`);
      log.push(`check: recovered == onChainIssuer -> ${issuerOk ? "OK" : "FAIL"}`);

      // Policy:
      // - "soft" mode: do NOT fail if issuer was removed later; just warn.
      // - "hard" mode: include trustedNow in ok.
      const HARD_REQUIRE_TRUSTED_ISSUER_NOW = false;

      const ok = HARD_REQUIRE_TRUSTED_ISSUER_NOW
        ? statusOk && issuerOk && trustedNow
        : statusOk && issuerOk;

      setVerifyOk(ok);

      if (!ok) {
        log.push("RESULT: NOT VERIFIED ❌");
        if (!statusOk) log.push(`reason: expected status Valid (1), got ${code} (${label})`);
        if (!issuerOk) log.push("reason: signature does not match on-chain issuer");
        if (HARD_REQUIRE_TRUSTED_ISSUER_NOW && !trustedNow) {
          log.push("reason: issuer is not on the trusted issuer list now");
        }
      } else {
        log.push("RESULT: VERIFIED ✅");
        if (!trustedNow) {
          log.push("WARNING: issuer is no longer on the trusted issuer list (historical record still valid).");
        }
      }
    } catch (e: any) {
      setVerifyOk(false);
      setError(e?.message ?? String(e));
      log.push(`ERROR: ${e?.message ?? String(e)}`);
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
          <button onClick={() => void verify()} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Verify
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {docHash && (
          <p>
            <b>docHash:</b> <code>{docHash}</code>
          </p>
        )}

        {recovered && (
          <p>
            <b>recovered signer:</b> <code>{recovered}</code>
          </p>
        )}

        {onChainStatus && (
          <p>
            <b>on-chain status:</b> {onChainStatus}
          </p>
        )}

        {issuerTrustedNow !== null && (
          <p>
            <b>issuer trusted now:</b>{" "}
            <span style={{ color: issuerTrustedNow ? "green" : "orange" }}>
              {issuerTrustedNow ? "YES" : "NO"}
            </span>
          </p>
        )}

        {onChainIssuer && (
          <div>
            <p>
              <b>on-chain record:</b>
            </p>
            <ul>
              <li>
                <b>issuer:</b> <code>{onChainIssuer}</code>
              </li>
              <li>
                <b>revoked:</b> {String(onChainRevoked)}
              </li>
            </ul>
          </div>
        )}

        {error && (
          <p style={{ color: "red" }}>
            <b>Error:</b> {error}
          </p>
        )}

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
