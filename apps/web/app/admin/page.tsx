"use client";

import { useMemo, useState } from "react";
import { isAddress, stringToHex, type Address, type Hex } from "viem";

import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readIsIssuer,
  readIssuerUniversityId,
  readOwner,
  readUniversity,
  universityStatusLabel,
} from "@/lib/univerify/registry";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import type { ChainState, TxState } from "@/lib/univerify/types";
import { writeIssuerAdminTx } from "@/lib/univerify/registryAdminWrite";

function nameToBytes32(name: string): Hex {
  return stringToHex(name.trim(), { size: 32 });
}

function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 32;
}

export default function AdminPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [owner, setOwner] = useState<Address | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  // Onboard form
  const [onboardIssuer, setOnboardIssuer] = useState("");
  const [onboardUniversityId, setOnboardUniversityId] = useState("1001");
  const [onboardName, setOnboardName] = useState("");

  // Manage university form
  const [manageUniversityId, setManageUniversityId] = useState("1001");
  const [manageName, setManageName] = useState("");
  const [manageStatus, setManageStatus] = useState("1");

  // Issuer ops form
  const [issuerOpsAddress, setIssuerOpsAddress] = useState("");
  const [assignUniversityId, setAssignUniversityId] = useState("1001");

  // Diagnostics
  const [checkUniversityId, setCheckUniversityId] = useState("1001");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const isBusy = txState !== "idle";

  function resetMessages() {
    setError("");
    setTxHash(null);
    log.clear();
  }

  async function connect() {
    resetMessages();
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) throw new Error(`Invalid wallet address: ${addr}`);
      const a = addr as Address;
      setAccount(a);

      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");

      const o = await readOwner({ publicClient, registry: REGISTRY });
      setOwner(o);
      const admin = a.toLowerCase() === o.toLowerCase();
      setIsAdmin(admin);

      log.push(`owner=${o}`);
      log.push(`account=${a} isAdmin=${admin}`);
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  async function onboardUniversityAndIssuer() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can run onboarding.");
    if (!isAddress(onboardIssuer)) return setError("Issuer address is invalid.");
    if (!/^\d+$/.test(onboardUniversityId.trim()) || onboardUniversityId.trim() === "0") return setError("University ID must be a positive integer.");
    if (!isValidName(onboardName)) return setError("University name is required (max 32 characters).");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });
      const universityId = BigInt(onboardUniversityId.trim());
      const universityName = nameToBytes32(onboardName);

      log.push("=== Onboard university + issuer ===");
      log.push(`issuer=${onboardIssuer}`);
      log.push(`universityId=${universityId.toString()}`);
      log.push(`name=${onboardName.trim()}`);

      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer: onboardIssuer as Address,
        universityId,
        universityName,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });

      log.push("RESULT=ONBOARDING_OK");
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`ERROR=${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function setUniversityOnChain() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can set university.");
    if (!/^\d+$/.test(manageUniversityId.trim()) || manageUniversityId.trim() === "0") return setError("University ID must be a positive integer.");
    if (!isValidName(manageName)) return setError("University name is required (max 32 characters).");
    if (!/^[123]$/.test(manageStatus)) return setError("Status must be 1=Active, 2=Suspended, 3=Revoked.");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });
      const universityId = BigInt(manageUniversityId.trim());
      const universityName = nameToBytes32(manageName);
      const status = Number(manageStatus);

      log.push("=== Set university ===");
      log.push(`universityId=${universityId.toString()}`);
      log.push(`name=${manageName.trim()}`);
      log.push(`status=${status} (${universityStatusLabel(status)})`);

      await writeIssuerAdminTx({
        fn: "setUniversity",
        universityId,
        universityName,
        universityStatus: status,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });

      const u = await readUniversity({ publicClient, registry: REGISTRY, universityId });
      log.push(`name.onchain=${u.name}`);
      log.push(`status.onchain=${u.status} (${universityStatusLabel(u.status)})`);
      log.push("RESULT=SET_UNIVERSITY_OK");
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`ERROR=${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function assignIssuerOnChainOnly() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can assign issuer.");
    if (!isAddress(issuerOpsAddress)) return setError("Issuer address is invalid.");
    if (!/^\d+$/.test(assignUniversityId.trim()) || assignUniversityId.trim() === "0") return setError("University ID must be a positive integer.");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });
      const universityId = BigInt(assignUniversityId.trim());

      const uni = await readUniversity({ publicClient, registry: REGISTRY, universityId });
      if (!uni.name) return setError("University not found on-chain. Run onboarding first.");

      log.push("=== Assign issuer ===");
      log.push(`issuer=${issuerOpsAddress}`);
      log.push(`universityId=${universityId.toString()} (${uni.name})`);

      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer: issuerOpsAddress as Address,
        universityId,
        universityName: stringToHex(uni.name, { size: 32 }),
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });

      const [ok, uid] = await Promise.all([
        readIsIssuer({ publicClient, registry: REGISTRY, issuer: issuerOpsAddress as Address }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer: issuerOpsAddress as Address }),
      ]);
      log.push(`isIssuer.after=${ok}`);
      log.push(`issuerUniversityId.after=${uid.toString()}`);
      log.push("RESULT=ASSIGN_ISSUER_OK");
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
    if (!isAddress(issuerOpsAddress)) return setError("Issuer address is invalid.");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });

      log.push("=== Remove issuer ===");
      log.push(`issuer=${issuerOpsAddress}`);

      await writeIssuerAdminTx({
        fn: "removeIssuer",
        issuer: issuerOpsAddress as Address,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });

      log.push("RESULT=REMOVE_ISSUER_OK");
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
      if (uid > 0n) {
        const uni = await readUniversity({ publicClient, registry: REGISTRY, universityId: uid });
        log.push(`isIssuer=${ok}`);
        log.push(`universityId=${uid.toString()}`);
        log.push(`universityName=${uni.name}`);
        log.push(`universityStatus=${uni.status} (${universityStatusLabel(uni.status)})`);
      } else {
        log.push(`isIssuer=${ok}`);
        log.push(`universityId=0 (not registered)`);
      }
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function checkUniversity() {
    resetMessages();
    if (!/^\d+$/.test(checkUniversityId.trim()) || checkUniversityId.trim() === "0") return setError("University ID must be a positive integer.");
    try {
      const uni = await readUniversity({
        publicClient,
        registry: REGISTRY,
        universityId: BigInt(checkUniversityId.trim()),
      });
      log.push(`university.name=${uni.name || "(not set)"}`);
      log.push(`university.status=${uni.status} (${universityStatusLabel(uni.status)})`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify — Admin</h1>
      <p className="uv-subtitle">Manage issuers and universities on-chain. Requires contract owner wallet.</p>

      <div className="uv-card">
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
            Connect MetaMask
          </button>
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
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div>
              <label className="uv-label">Issuer address</label>
              <input value={onboardIssuer} onChange={(e) => setOnboardIssuer(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
            </div>
            <div>
              <label className="uv-label">University ID (uint64)</label>
              <input value={onboardUniversityId} onChange={(e) => setOnboardUniversityId(e.target.value.trim())} placeholder="1001" className="uv-input uv-mono" />
            </div>
            <div>
              <label className="uv-label">University name <span className="uv-muted">(max 32 chars)</span></label>
              <input
                value={onboardName}
                onChange={(e) => setOnboardName(e.target.value)}
                placeholder="Politechnika Warszawska"
                maxLength={32}
                className="uv-input"
              />
              <p className="uv-hint">{onboardName.trim().length}/32 characters</p>
            </div>
          </div>
          <div className="uv-actions">
            <button onClick={() => void onboardUniversityAndIssuer()} disabled={isBusy} className="uv-btn uv-btn-primary">
              Onboard (1 transaction)
            </button>
          </div>
          <p className="uv-hint">Registers the university on-chain and assigns the issuer in a single transaction.</p>
        </details>

        <details className="uv-details">
          <summary>Update University Status / Name</summary>
          <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
            <div>
              <label className="uv-label">University ID</label>
              <input value={manageUniversityId} onChange={(e) => setManageUniversityId(e.target.value.trim())} placeholder="1001" className="uv-input uv-mono" />
            </div>
            <div>
              <label className="uv-label">University name <span className="uv-muted">(max 32 chars)</span></label>
              <input
                value={manageName}
                onChange={(e) => setManageName(e.target.value)}
                placeholder="Politechnika Warszawska"
                maxLength={32}
                className="uv-input"
              />
              <p className="uv-hint">{manageName.trim().length}/32 characters</p>
            </div>
            <div>
              <label className="uv-label">Status</label>
              <select value={manageStatus} onChange={(e) => setManageStatus(e.target.value)} className="uv-input">
                <option value="1">Active</option>
                <option value="2">Suspended</option>
                <option value="3">Revoked</option>
              </select>
            </div>
          </div>
          <div className="uv-actions">
            <button onClick={() => void setUniversityOnChain()} disabled={isBusy} className="uv-btn uv-btn-primary">
              Update university
            </button>
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
            <button onClick={() => void assignIssuerOnChainOnly()} disabled={isBusy} className="uv-btn">Assign issuer</button>
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
      {error && (
        <div className="uv-status-banner uv-status-fail">
          <b>Error:</b> {error}
        </div>
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
