"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import type { ChainState, OnChainRecord, TxState, DiplomaEnvelopeEip712 } from "@/lib/univerify/types";
import { buildUniVerifyDomain, recoverIssuerFromEip712, DIPLOMA_TYPES } from "@/lib/univerify/eip712";
import { makePublicClient, readRecord, readStatus, statusLabel } from "@/lib/univerify/registry";
import { downloadJson, parseJson } from "@/lib/univerify/json";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import { writeRegistryTx } from "@/lib/univerify/registryWrite";

export default function IssuerPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");

  const [jsonText, setJsonText] = useState(
    `{
  "student": {
    "firstName": "Jan",
    "lastName": "Kowalski",
    "studentId": "s123456"
  },
  "degree": { "name": "Bachelor of Computer Science", "level": "BSc" },
  "university": { "name": "UniVerify University", "country": "Poland" },
  "issuedAt": "2025-06-30",
  "diplomaNumber": "UV-2025-000123"
}`.trim()
  );

  const [docHash, setDocHash] = useState<Hex | null>(null);
  const [signature, setSignature] = useState<Hex | null>(null);

  const [status, setStatus] = useState<string>("");
  const [record, setRecord] = useState<OnChainRecord | null>(null);

  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [error, setError] = useState<string>("");

  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const [verifyOK, setVerifyOk] = useState<boolean | null>(null);

  const isBusy = txState !== "idle";
  const hasWallet = !!account;

  function resetMessages() {
    setError("");
    setTxHash(null);
    setVerifyOk(null);
    log.clear();
  }

  function resetOnChainView() {
    setStatus("");
    setRecord(null);
  }

  function resetComputed() {
    setDocHash(null);
    setSignature(null);
  }

  async function connect() {
    resetMessages();
    resetOnChainView();

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh the page.");

    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) return setError(`Invalid address returned by wallet: ${addr}`);
      setAccount(addr as Address);

      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  function computeDocHash() {
    resetMessages();
    resetOnChainView();
    setSignature(null);

    const parsed = parseJson(jsonText);
    if (!parsed.ok) return setError(parsed.error);

    setDocHash(hashPayload(parsed.value));
  }

  async function refreshOnChain(h: Hex) {
    const code = await readStatus({ publicClient, registry: REGISTRY, docHash: h });
    setStatus(statusLabel(code));

    const rec = await readRecord({ publicClient, registry: REGISTRY, docHash: h });
    setRecord({ issuer: rec.issuer, revoked: rec.revoked });
  }

  async function checkOnChainStatus() {
    resetMessages();
    if (!docHash) return setError("Compute docHash first");
    try {
      await refreshOnChain(docHash);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function signDocHash() {
    resetMessages();
    if (!docHash) return setError("Compute docHash first");
    if (!account) return setError("Connect MetaMask first");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh the page.");

    setTxState("signing");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");

      const walletClient = makeWalletClient({ eth, account });
      const domain = buildUniVerifyDomain({ chainId: TARGET_CHAIN_ID, registry: REGISTRY });

      const sig = await walletClient.signTypedData({
        account,
        domain,
        types: DIPLOMA_TYPES,
        primaryType: "Diploma",
        message: { docHash },
      });

      const recovered = await recoverIssuerFromEip712({ docHash, signature: sig, domain });
      if (recovered.toLowerCase() !== account.toLowerCase()) {
        throw new Error("EIP-712 signature sanity-check failed (recovered address mismatch).");
      }

      setSignature(sig);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setTxState("idle");
    }
  }

  async function verifySignatureAndChain() {
    resetMessages();
    if (!docHash) return setError("Compute docHash first");
    if (!signature) return setError("Sign docHash first");

    try {
      const domain = buildUniVerifyDomain({ chainId: TARGET_CHAIN_ID, registry: REGISTRY });

      log.push("=== UniVerify verify (EIP-712 + chain) ===");
      log.push(`docHash: ${docHash}`);
      log.push(`domain.chainId: ${domain.chainId}`);
      log.push(`domain.verifyingContract: ${domain.verifyingContract}`);
      log.push(`signature: ${signature}`);

      const recovered = await recoverIssuerFromEip712({ docHash, signature, domain });
      log.push(`recovered signer: ${recovered}`);

      const code = await readStatus({ publicClient, registry: REGISTRY, docHash });
      const label = statusLabel(code);
      log.push(`on-chain status: ${code} (${label})`);

      const rec = await readRecord({ publicClient, registry: REGISTRY, docHash });
      log.push(`on-chain issuer: ${rec.issuer}`);
      log.push(`on-chain revoked: ${String(rec.revoked)}`);

      setStatus(label);
      setRecord({ issuer: rec.issuer, revoked: rec.revoked });

      const statusOk = code === 1;
      const issuerOk = recovered.toLowerCase() === rec.issuer.toLowerCase();

      log.push(`check: status == Valid -> ${statusOk ? "OK" : "FAIL"}`);
      log.push(`check: recovered == onChainIssuer -> ${issuerOk ? "OK" : "FAIL"}`);

      const ok = statusOk && issuerOk;
      setVerifyOk(ok);
      log.push(`RESULT: ${ok ? "VERIFIED ✅" : "NOT VERIFIED ❌"}`);
    } catch (e: any) {
      setVerifyOk(false);
      setError(e?.message ?? String(e));
      log.push(`ERROR: ${e?.message ?? String(e)}`);
    }
  }

  function exportDiplomaJson() {
    resetMessages();

    const parsed = parseJson(jsonText);
    if (!parsed.ok) return setError(parsed.error);
    if (!docHash) return setError("Compute docHash first");
    if (!signature) return setError("Sign docHash first");

    const domain = buildUniVerifyDomain({ chainId: TARGET_CHAIN_ID, registry: REGISTRY });

    const envelope: DiplomaEnvelopeEip712 = {
      payload: parsed.value,
      proof: {
        type: "EIP712",
        domain,
        types: DIPLOMA_TYPES,
        primaryType: "Diploma",
        signature,
        issuer: account || undefined,
      },
    };

    downloadJson(`univerify-diploma-${docHash}.json`, envelope);
  }

  async function writeTx(fn: "issue" | "revoke") {
    resetMessages();
    if (!docHash) return setError("Compute docHash first");
    if (!account) return setError("Connect MetaMask first");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh the page.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");

      const walletClient = makeWalletClient({ eth, account });

      await writeRegistryTx({
        fn,
        docHash,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
        onAfter: async () => {
          await refreshOnChain(docHash);
        },
      });
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Issuer</h1>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void connect()} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
          Connect MetaMask
        </button>
        <div>
          <div><b>Account:</b> {account || "-"}</div>
          <div><b>Network:</b> {chainState === "ok" ? "OK" : chainState === "wrong" ? "Wrong network" : "-"}</div>
          <div><b>Registry:</b> <code>{REGISTRY}</code></div>
          {!hasWallet && (
            <div style={{ marginTop: 6, color: "orange" }}>
              Connect MetaMask to sign and send transactions.
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Payload JSON</label>
        <textarea
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            resetComputed();
            resetOnChainView();
            resetMessages();
          }}
          rows={12}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={computeDocHash} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Compute docHash
          </button>

          <button
            onClick={() => void signDocHash()}
            disabled={isBusy || !docHash || !hasWallet}
            style={{ padding: "10px 14px", fontWeight: 600 }}
          >
            Sign docHash (EIP-712)
          </button>

          <button
            onClick={exportDiplomaJson}
            disabled={isBusy || !docHash || !signature}
            style={{ padding: "10px 14px", fontWeight: 600 }}
          >
            Export diploma.json
          </button>

          <button
            onClick={() => void checkOnChainStatus()}
            disabled={isBusy || !docHash}
            style={{ padding: "10px 14px", fontWeight: 600 }}
          >
            Check status (chain)
          </button>

          <button
            onClick={() => void verifySignatureAndChain()}
            disabled={isBusy || !docHash || !signature}
            style={{ padding: "10px 14px", fontWeight: 600 }}
          >
            Verify (EIP-712 + chain)
          </button>

          {/* IMPORTANT: do NOT disable on !account, so user gets an explicit error on click */}
          <button
            onClick={() => void writeTx("issue")}
            disabled={isBusy || !docHash}
            style={{ padding: "10px 14px", fontWeight: 600 }}
          >
            Issue (tx)
          </button>

          <button
            onClick={() => void writeTx("revoke")}
            disabled={isBusy || !docHash}
            style={{ padding: "10px 14px", fontWeight: 600 }}
          >
            Revoke (tx)
          </button>
        </div>

        {txState !== "idle" && (
          <p style={{ marginTop: 10 }}>
            <b>State:</b> {txState}
          </p>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        {docHash && <p><b>docHash:</b> <code>{docHash}</code></p>}
        {signature && <p><b>signature (EIP-712):</b> <code>{signature}</code></p>}
        {status && <p><b>Status:</b> {status}</p>}

        {record && (
          <div>
            <p><b>Record:</b></p>
            <ul>
              <li><b>issuer:</b> <code>{record.issuer}</code></li>
              <li><b>revoked:</b> {String(record.revoked)}</li>
            </ul>
          </div>
        )}

        {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}
        {error && <p style={{ color: "red" }}><b>Error:</b> {error}</p>}

        {verifyOK !== null && (
          <p style={{ color: verifyOK ? "green" : "red" }}>
            <b>Verification result:</b> {verifyOK ? "VERIFIED ✅" : "NOT VERIFIED ❌"}
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
