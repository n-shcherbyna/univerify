"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";

import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readIsIssuer,
  readIssuerUniversityId,
  readOwner,
  readUniversityMeta,
  readUniversityStatus,
  universityStatusLabel,
} from "@/lib/univerify/registry";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import type { ChainState, TxState } from "@/lib/univerify/types";
import { writeIssuerAdminTx } from "@/lib/univerify/registryAdminWrite";

type UniversityForm = { id: string; name: string; country: string; website: string; accreditationId: string };

const EMPTY_UNI: UniversityForm = { id: "1001", name: "", country: "", website: "", accreditationId: "" };

function uniFormValid(f: UniversityForm): boolean {
  return /^\d+$/.test(f.id.trim()) && f.id.trim() !== "0" && f.name.trim().length > 0;
}

export default function AdminPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID, deployBlock: DEPLOY_BLOCK } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [owner, setOwner] = useState<Address | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [onboardIssuer, setOnboardIssuer] = useState("");
  const [onboardUni, setOnboardUni] = useState<UniversityForm>(EMPTY_UNI);

  const [manageUni, setManageUni] = useState<UniversityForm>(EMPTY_UNI);
  const [manageStatus, setManageStatus] = useState("1");

  const [issuerOpsAddress, setIssuerOpsAddress] = useState("");
  const [assignUniversityId, setAssignUniversityId] = useState("1001");

  const [checkUniversityId, setCheckUniversityId] = useState("1001");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);
  const isBusy = txState !== "idle";

  function resetMessages() { setError(""); setTxHash(null); log.clear(); }

  async function connect() {
    resetMessages();
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) throw new Error(`Invalid address: ${addr}`);
      const a = addr as Address;
      setAccount(a);
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const o = await readOwner({ publicClient, registry: REGISTRY });
      setOwner(o);
      setIsAdmin(a.toLowerCase() === o.toLowerCase());
      log.push(`owner=${o} account=${a}`);
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  async function onboard() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can run onboarding.");
    if (!isAddress(onboardIssuer)) return setError("Invalid issuer address.");
    if (!uniFormValid(onboardUni)) return setError("University ID and name are required.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      const walletClient = makeWalletClient({ eth, account });
      log.push("=== Onboard university + issuer ===");
      log.push(`issuer=${onboardIssuer} universityId=${onboardUni.id} name=${onboardUni.name.trim()}`);
      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer: onboardIssuer as Address,
        universityId: BigInt(onboardUni.id.trim()),
        name: onboardUni.name.trim(),
        country: onboardUni.country.trim(),
        website: onboardUni.website.trim(),
        accreditationId: onboardUni.accreditationId.trim(),
        registry: REGISTRY, account, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      log.push("RESULT=OK");
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`ERROR=${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function setUniversity() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can set university.");
    if (!uniFormValid(manageUni)) return setError("University ID and name are required.");
    if (!/^[123]$/.test(manageStatus)) return setError("Status must be 1=Active, 2=Suspended, 3=Revoked.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      const walletClient = makeWalletClient({ eth, account });
      const status = Number(manageStatus);
      log.push(`=== Set university id=${manageUni.id} name=${manageUni.name.trim()} status=${universityStatusLabel(status)} ===`);
      await writeIssuerAdminTx({
        fn: "setUniversity",
        universityId: BigInt(manageUni.id.trim()),
        status,
        name: manageUni.name.trim(),
        country: manageUni.country.trim(),
        website: manageUni.website.trim(),
        accreditationId: manageUni.accreditationId.trim(),
        registry: REGISTRY, account, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      log.push("RESULT=OK");
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`ERROR=${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function assignIssuer() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can assign issuer.");
    if (!isAddress(issuerOpsAddress)) return setError("Invalid issuer address.");
    if (!/^\d+$/.test(assignUniversityId.trim()) || assignUniversityId.trim() === "0") return setError("Invalid university ID.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      const walletClient = makeWalletClient({ eth, account });
      const universityId = BigInt(assignUniversityId.trim());
      const meta = await readUniversityMeta({ publicClient, registry: REGISTRY, universityId, fromBlock: DEPLOY_BLOCK });
      if (!meta) return setError(`University ${universityId} not found on-chain. Run onboarding first.`);
      log.push(`=== Assign issuer=${issuerOpsAddress} to universityId=${universityId} (${meta.name}) ===`);
      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer: issuerOpsAddress as Address,
        universityId,
        name: meta.name, country: meta.country, website: meta.website, accreditationId: meta.accreditationId,
        registry: REGISTRY, account, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      log.push("RESULT=OK");
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`ERROR=${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function removeIssuer() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can remove issuer.");
    if (!isAddress(issuerOpsAddress)) return setError("Invalid issuer address.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      const walletClient = makeWalletClient({ eth, account });
      log.push(`=== Remove issuer=${issuerOpsAddress} ===`);
      await writeIssuerAdminTx({
        fn: "removeIssuer", issuer: issuerOpsAddress as Address,
        registry: REGISTRY, account, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      log.push("RESULT=OK");
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`ERROR=${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function checkIssuer() {
    resetMessages();
    if (!isAddress(issuerOpsAddress)) return setError("Enter a valid issuer address.");
    try {
      const issuer = issuerOpsAddress as Address;
      const [ok, uid] = await Promise.all([
        readIsIssuer({ publicClient, registry: REGISTRY, issuer }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer }),
      ]);
      log.push(`isIssuer=${ok} universityId=${uid.toString()}`);
      if (uid > 0n) {
        const meta = await readUniversityMeta({ publicClient, registry: REGISTRY, universityId: uid, fromBlock: DEPLOY_BLOCK });
        if (meta) log.push(`university=${meta.name} (${meta.country}) status=${universityStatusLabel(meta.status)}`);
      }
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }

  async function checkUniversity() {
    resetMessages();
    if (!/^\d+$/.test(checkUniversityId.trim()) || checkUniversityId.trim() === "0") return setError("Invalid university ID.");
    try {
      const universityId = BigInt(checkUniversityId.trim());
      const [status, meta] = await Promise.all([
        readUniversityStatus({ publicClient, registry: REGISTRY, universityId }),
        readUniversityMeta({ publicClient, registry: REGISTRY, universityId, fromBlock: DEPLOY_BLOCK }),
      ]);
      log.push(`status=${status} (${universityStatusLabel(status)})`);
      if (meta) {
        log.push(`name=${meta.name}`);
        if (meta.country) log.push(`country=${meta.country}`);
        if (meta.website) log.push(`website=${meta.website}`);
        if (meta.accreditationId) log.push(`accreditation=${meta.accreditationId}`);
      } else {
        log.push("no metadata found in events");
      }
    } catch (e: any) { setError(e?.message ?? String(e)); }
  }

  function uniFields(f: UniversityForm, onChange: (f: UniversityForm) => void, showId = true) {
    return (
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {showId && (
          <div>
            <label className="uv-label">University ID</label>
            <input value={f.id} onChange={(e) => onChange({ ...f, id: e.target.value.trim() })} placeholder="1001" className="uv-input uv-mono" />
          </div>
        )}
        <div>
          <label className="uv-label">Name <span className="uv-muted">(required)</span></label>
          <input value={f.name} onChange={(e) => onChange({ ...f, name: e.target.value })} placeholder="Politechnika Warszawska" className="uv-input" />
        </div>
        <div>
          <label className="uv-label">Country <span className="uv-muted">(optional)</span></label>
          <input value={f.country} onChange={(e) => onChange({ ...f, country: e.target.value })} placeholder="PL" className="uv-input" />
        </div>
        <div>
          <label className="uv-label">Website <span className="uv-muted">(optional)</span></label>
          <input value={f.website} onChange={(e) => onChange({ ...f, website: e.target.value })} placeholder="https://pw.edu.pl" className="uv-input" />
        </div>
        <div>
          <label className="uv-label">Accreditation ID <span className="uv-muted">(optional)</span></label>
          <input value={f.accreditationId} onChange={(e) => onChange({ ...f, accreditationId: e.target.value })} placeholder="PKA-2024-001" className="uv-input" />
        </div>
      </div>
    );
  }

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify — Admin</h1>
      <p className="uv-subtitle">Manage issuers and universities on-chain. Requires contract owner wallet.</p>

      <div className="uv-card">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">Connect MetaMask</button>
          <div className="uv-kv" style={{ marginTop: 0, flex: 1 }}>
            <b>Account</b><code>{account || "-"}</code>
            <b>Network</b><span>{chainState === "ok" ? "✓ OK" : chainState === "wrong" ? "⚠ Wrong network" : "-"}</span>
            <b>Registry</b><code>{REGISTRY}</code>
            <b>Owner</b><code>{owner ?? "-"}</code>
            <b>Admin</b><span style={{ color: isAdmin ? "#166534" : "#b45309", fontWeight: 600 }}>{account ? (isAdmin ? "YES" : "NO") : "-"}</span>
          </div>
        </div>
      </div>

      <div className="uv-card">
        <h2 className="uv-card-title">Operations</h2>

        <details className="uv-details" open>
          <summary>Onboard University + Issuer</summary>
          <div style={{ marginTop: 12 }}>
            <label className="uv-label">Issuer address</label>
            <input value={onboardIssuer} onChange={(e) => setOnboardIssuer(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
          </div>
          {uniFields(onboardUni, setOnboardUni)}
          <div className="uv-actions">
            <button onClick={() => void onboard()} disabled={isBusy} className="uv-btn uv-btn-primary">Onboard (1 transaction)</button>
          </div>
          <p className="uv-hint">Registers university on-chain and assigns the issuer in a single transaction.</p>
        </details>

        <details className="uv-details">
          <summary>Update University</summary>
          {uniFields(manageUni, setManageUni)}
          <div style={{ marginTop: 10 }}>
            <label className="uv-label">Status</label>
            <select value={manageStatus} onChange={(e) => setManageStatus(e.target.value)} className="uv-input">
              <option value="1">Active</option>
              <option value="2">Suspended</option>
              <option value="3">Revoked</option>
            </select>
          </div>
          <div className="uv-actions">
            <button onClick={() => void setUniversity()} disabled={isBusy} className="uv-btn uv-btn-primary">Update university</button>
          </div>
        </details>

        <details className="uv-details">
          <summary>Issuer Operations</summary>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div>
              <label className="uv-label">Issuer address</label>
              <input value={issuerOpsAddress} onChange={(e) => setIssuerOpsAddress(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
            </div>
            <div>
              <label className="uv-label">Assign to university ID</label>
              <input value={assignUniversityId} onChange={(e) => setAssignUniversityId(e.target.value.trim())} placeholder="1001" className="uv-input uv-mono" />
            </div>
          </div>
          <div className="uv-actions">
            <button onClick={() => void checkIssuer()} disabled={isBusy} className="uv-btn">Check issuer</button>
            <button onClick={() => void assignIssuer()} disabled={isBusy} className="uv-btn">Assign issuer</button>
            <button onClick={() => void removeIssuer()} disabled={isBusy} className="uv-btn uv-btn-danger">Remove issuer</button>
          </div>
        </details>

        <details className="uv-details">
          <summary>Diagnostics</summary>
          <div style={{ marginTop: 12 }}>
            <label className="uv-label">University ID</label>
            <input value={checkUniversityId} onChange={(e) => setCheckUniversityId(e.target.value.trim())} placeholder="1001" className="uv-input uv-mono" />
          </div>
          <div className="uv-actions">
            <button onClick={() => void checkUniversity()} disabled={isBusy} className="uv-btn">Check university</button>
          </div>
        </details>
      </div>

      {(txState !== "idle" || txHash) && (
        <div className="uv-status-banner uv-status-ok">
          {txState !== "idle" && <p><b>State:</b> {txState}</p>}
          {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}
        </div>
      )}
      {error && <div className="uv-status-banner uv-status-fail"><b>Error:</b> {error}</div>}

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
