"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";

import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readIsIssuer,
  readIssuerUniversityId,
  readOwner,
  readPendingOwner,
  readRegistryOverview,
  readUniversityMeta,
  universityStatusLabel,
  type IssuerOverview,
  type UniversityOverview,
} from "@/lib/univerify/registry";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import type { ChainState, TxState } from "@/lib/univerify/types";
import { writeIssuerAdminTx } from "@/lib/univerify/registryAdminWrite";

type UniversityForm = { id: string; name: string; country: string; website: string; accreditationId: string };
type Tab = "overview" | "onboard" | "university" | "issuer" | "ownership";

const EMPTY_UNI: UniversityForm = { id: "", name: "", country: "", website: "", accreditationId: "" };

const STATUS_BADGE: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: "Active",    color: "#166534", bg: "#dcfce7" },
  2: { label: "Suspended", color: "#92400e", bg: "#fef3c7" },
  3: { label: "Revoked",   color: "#991b1b", bg: "#fee2e2" },
};
function StatusBadge({ status }: { status: number }) {
  const s = STATUS_BADGE[status] ?? { label: "Unknown", color: "#6b7280", bg: "#f3f4f6" };
  return (
    <span className="uv-badge" style={{ color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

function uniFormValid(f: UniversityForm): boolean {
  return /^\d+$/.test(f.id.trim()) && f.id.trim() !== "0" && f.name.trim().length > 0;
}

export default function AdminPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID, deployBlock: DEPLOY_BLOCK } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL, TARGET_CHAIN_ID), [RPC_URL, TARGET_CHAIN_ID]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [owner, setOwner] = useState<Address | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [pendingOwner, setPendingOwner] = useState<Address | null>(null);
  const [isPendingOwner, setIsPendingOwner] = useState(false);
  const [tab, setTab] = useState<Tab>("overview");

  // Overview state
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [universities, setUniversities] = useState<UniversityOverview[]>([]);
  const [issuers, setIssuers] = useState<IssuerOverview[]>([]);
  const [overviewError, setOverviewError] = useState("");

  // Forms
  const [onboardIssuer, setOnboardIssuer] = useState("");
  const [onboardUni, setOnboardUni] = useState<UniversityForm>(EMPTY_UNI);
  const [manageUni, setManageUni] = useState<UniversityForm>(EMPTY_UNI);
  const [manageStatus, setManageStatus] = useState("1");
  const [issuerOpsAddress, setIssuerOpsAddress] = useState("");
  const [assignUniversityId, setAssignUniversityId] = useState("");
  const [transferTarget, setTransferTarget] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);
  const isBusy = txState !== "idle";

  function resetMessages() { setError(""); setTxHash(null); }

  async function loadOverview() {
    setOverviewLoading(true);
    setOverviewError("");
    try {
      const { universities: unis, issuers: iss } = await readRegistryOverview({
        publicClient, registry: REGISTRY, fromBlock: DEPLOY_BLOCK,
      });
      setUniversities(unis);
      setIssuers(iss);
    } catch (e: any) {
      setOverviewError(e?.message ?? String(e));
    } finally {
      setOverviewLoading(false);
    }
  }

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
      const [o, po] = await Promise.all([
        readOwner({ publicClient, registry: REGISTRY }),
        readPendingOwner({ publicClient, registry: REGISTRY }),
      ]);
      setOwner(o);
      setIsAdmin(a.toLowerCase() === o.toLowerCase());
      const hasPending = po !== "0x0000000000000000000000000000000000000000";
      setPendingOwner(hasPending ? po : null);
      setIsPendingOwner(hasPending && a.toLowerCase() === po.toLowerCase());
      await loadOverview();
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  async function runTx(fn: () => Promise<void>, { allowPendingOwner = false } = {}) {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin && !(allowPendingOwner && isPendingOwner)) return setError("Only contract owner can perform this action.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      const walletClient = makeWalletClient({ eth, account, chainId: TARGET_CHAIN_ID });
      await fn();
      await loadOverview();
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function onboard() {
    if (!isAddress(onboardIssuer)) return setError("Invalid issuer address.");
    if (!uniFormValid(onboardUni)) return setError("University ID and name are required.");
    const eth = getEthereum()!;
    await runTx(async () => {
      const walletClient = makeWalletClient({ eth, account: account as Address, chainId: TARGET_CHAIN_ID });
      log.push(`Onboard: issuer=${onboardIssuer} universityId=${onboardUni.id} name=${onboardUni.name}`);
      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer: onboardIssuer as Address,
        universityId: BigInt(onboardUni.id.trim()),
        name: onboardUni.name.trim(), country: onboardUni.country.trim(),
        website: onboardUni.website.trim(), accreditationId: onboardUni.accreditationId.trim(),
        registry: REGISTRY, account: account as Address, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      setOnboardUni(EMPTY_UNI);
      setOnboardIssuer("");
      setTab("overview");
    });
  }

  async function setUniversity() {
    if (!uniFormValid(manageUni)) return setError("University ID and name are required.");
    if (!/^[123]$/.test(manageStatus)) return setError("Invalid status.");
    const eth = getEthereum()!;
    await runTx(async () => {
      const walletClient = makeWalletClient({ eth, account: account as Address, chainId: TARGET_CHAIN_ID });
      const status = Number(manageStatus);
      log.push(`Set university: id=${manageUni.id} status=${universityStatusLabel(status)}`);
      await writeIssuerAdminTx({
        fn: "setUniversity",
        universityId: BigInt(manageUni.id.trim()), status,
        name: manageUni.name.trim(), country: manageUni.country.trim(),
        website: manageUni.website.trim(), accreditationId: manageUni.accreditationId.trim(),
        registry: REGISTRY, account: account as Address, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      setTab("overview");
    });
  }

  async function assignIssuer() {
    if (!isAddress(issuerOpsAddress)) return setError("Invalid issuer address.");
    if (!/^\d+$/.test(assignUniversityId.trim()) || assignUniversityId.trim() === "0") return setError("Invalid university ID.");
    const eth = getEthereum()!;
    await runTx(async () => {
      const walletClient = makeWalletClient({ eth, account: account as Address, chainId: TARGET_CHAIN_ID });
      const universityId = BigInt(assignUniversityId.trim());
      const meta = await readUniversityMeta({ publicClient, registry: REGISTRY, universityId, fromBlock: DEPLOY_BLOCK });
      if (!meta) return setError(`University ${universityId} not found. Onboard it first.`);
      log.push(`Assign issuer=${issuerOpsAddress} \u2192 universityId=${universityId} (${meta.name})`);
      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer: issuerOpsAddress as Address, universityId,
        name: meta.name, country: meta.country, website: meta.website, accreditationId: meta.accreditationId,
        registry: REGISTRY, account: account as Address, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      setIssuerOpsAddress("");
      setTab("overview");
    });
  }

  async function removeIssuer() {
    if (!isAddress(issuerOpsAddress)) return setError("Invalid issuer address.");
    const eth = getEthereum()!;
    await runTx(async () => {
      const walletClient = makeWalletClient({ eth, account: account as Address, chainId: TARGET_CHAIN_ID });
      log.push(`Remove issuer=${issuerOpsAddress}`);
      await writeIssuerAdminTx({
        fn: "removeIssuer", issuer: issuerOpsAddress as Address,
        registry: REGISTRY, account: account as Address, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      setIssuerOpsAddress("");
      setTab("overview");
    });
  }

  async function transferOwnership() {
    if (!isAddress(transferTarget)) return setError("Invalid address.");
    const eth = getEthereum()!;
    await runTx(async () => {
      const walletClient = makeWalletClient({ eth, account: account as Address, chainId: TARGET_CHAIN_ID });
      log.push(`Transfer ownership \u2192 ${transferTarget}`);
      await writeIssuerAdminTx({
        fn: "transferOwnership", newOwner: transferTarget as Address,
        registry: REGISTRY, account: account as Address, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
      setTransferTarget("");
    });
    await connect();
  }

  async function acceptOwnership() {
    const eth = getEthereum()!;
    await runTx(async () => {
      const walletClient = makeWalletClient({ eth, account: account as Address, chainId: TARGET_CHAIN_ID });
      log.push("Accept ownership");
      await writeIssuerAdminTx({
        fn: "acceptOwnership",
        registry: REGISTRY, account: account as Address, publicClient, walletClient, setTxState, onTxHash: setTxHash,
      });
    }, { allowPendingOwner: true });
    await connect();
  }

  function prefillUniForm(uni: UniversityOverview) {
    setManageUni({
      id: uni.universityId.toString(),
      name: uni.name, country: uni.country,
      website: uni.website, accreditationId: uni.accreditationId,
    });
    setManageStatus(String(uni.status));
    setTab("university");
  }

  function prefillIssuerForm(issuer: IssuerOverview) {
    setIssuerOpsAddress(issuer.issuer);
    setAssignUniversityId(issuer.universityId.toString());
    setTab("issuer");
  }

  function uniFields(f: UniversityForm, onChange: (f: UniversityForm) => void, showId = true) {
    return (
      <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
        {showId && (
          <div>
            <label className="uv-label">University ID</label>
            <input value={f.id} onChange={(e) => onChange({ ...f, id: e.target.value.trim() })} placeholder="1001" className="uv-input uv-mono" style={{ width: 180 }} />
          </div>
        )}
        <div>
          <label className="uv-label">Name <span className="uv-muted">(required)</span></label>
          <input value={f.name} onChange={(e) => onChange({ ...f, name: e.target.value })} placeholder="Politechnika Warszawska" className="uv-input" />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div>
            <label className="uv-label">Country</label>
            <input value={f.country} onChange={(e) => onChange({ ...f, country: e.target.value })} placeholder="PL" className="uv-input" />
          </div>
          <div>
            <label className="uv-label">Accreditation ID</label>
            <input value={f.accreditationId} onChange={(e) => onChange({ ...f, accreditationId: e.target.value })} placeholder="PKA-2024-001" className="uv-input" />
          </div>
        </div>
        <div>
          <label className="uv-label">Website</label>
          <input value={f.website} onChange={(e) => onChange({ ...f, website: e.target.value })} placeholder="https://pw.edu.pl" className="uv-input" />
        </div>
      </div>
    );
  }

  const tabs: { id: Tab; label: string }[] = [
    { id: "overview",    label: "Overview" },
    { id: "onboard",     label: "Onboard" },
    { id: "university",  label: "Update university" },
    { id: "issuer",      label: "Manage issuer" },
    { id: "ownership",   label: "Ownership" },
  ];

  return (
    <main className="uv-page">
      <h1 className="uv-title"><span className="uv-title-gradient">Admin</span></h1>
      <p className="uv-subtitle">Manage issuers and universities on-chain. Requires contract owner wallet.</p>

      {/* Wallet bar */}
      <div className="uv-card uv-wallet-bar">
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          {account ? "Reconnect" : "Connect MetaMask"}
        </button>
        <div className="uv-kv" style={{ flex: 1, marginTop: 0, gap: "4px 16px" }}>
          <b>Account</b><code>{account || "\u2014"}</code>
          <b>Owner</b><code>{owner ?? "\u2014"}</code>
          <b>Access</b>
          <span style={{ fontWeight: 700, color: account ? (isAdmin ? "var(--success)" : "var(--warn)") : undefined }}>
            {account ? (isAdmin ? "\u2713 Owner" : "\u2717 Not owner") : "\u2014"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="uv-tabs">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`uv-tab ${tab === t.id ? "uv-tab-active" : ""}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* OVERVIEW */}
      {tab === "overview" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="uv-card-title">Registry state</h2>
            <button onClick={() => void loadOverview()} disabled={overviewLoading} className="uv-btn" style={{ fontSize: 13, padding: "6px 14px" }}>
              {overviewLoading ? "Loading\u2026" : "\u21ba Refresh"}
            </button>
          </div>

          {overviewError && <div className="uv-status-banner uv-status-fail" style={{ marginTop: 8 }}>{overviewError}</div>}

          {!overviewLoading && universities.length === 0 && issuers.length === 0 && (
            <p className="uv-hint" style={{ marginTop: 12 }}>No data. Click Refresh or connect wallet.</p>
          )}

          {universities.length > 0 && (
            <>
              <h3 className="uv-section-heading">
                Universities <span className="uv-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({universities.length})</span>
              </h3>
              <div className="uv-table-wrap">
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Name</th>
                      <th>Country</th>
                      <th>Status</th>
                      <th>Accreditation</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {universities.map((u) => (
                      <tr key={u.universityId.toString()}>
                        <td><code>{u.universityId.toString()}</code></td>
                        <td style={{ fontWeight: 600 }}>{u.name}</td>
                        <td>{u.country || <span className="uv-muted">\u2014</span>}</td>
                        <td><StatusBadge status={u.status} /></td>
                        <td>{u.accreditationId || <span className="uv-muted">\u2014</span>}</td>
                        <td>
                          {isAdmin && (
                            <button onClick={() => prefillUniForm(u)} className="uv-btn" style={{ fontSize: 12, padding: "4px 12px" }}>
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {issuers.length > 0 && (
            <>
              <h3 className="uv-section-heading">
                Issuers <span className="uv-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({issuers.filter(i => i.active).length} active / {issuers.length} total)</span>
              </h3>
              <div className="uv-table-wrap">
                <table style={{ width: "100%" }}>
                  <thead>
                    <tr>
                      <th>Address</th>
                      <th>University</th>
                      <th>Status</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {issuers.map((iss) => (
                      <tr key={iss.issuer} style={{ opacity: iss.active ? 1 : 0.5 }}>
                        <td><code style={{ fontSize: 11 }}>{iss.issuer}</code></td>
                        <td>
                          {iss.universityName
                            ? <span><span className="uv-muted" style={{ fontSize: 11 }}>#{iss.universityId.toString()} </span>{iss.universityName}</span>
                            : <span className="uv-muted">\u2014</span>}
                        </td>
                        <td>
                          <span className="uv-badge" style={{
                            color: iss.active ? "#166534" : "#6b7280",
                            background: iss.active ? "#dcfce7" : "#f3f4f6",
                          }}>
                            {iss.active ? "Active" : "Removed"}
                          </span>
                        </td>
                        <td>
                          {isAdmin && (
                            <button onClick={() => prefillIssuerForm(iss)} className="uv-btn" style={{ fontSize: 12, padding: "4px 12px" }}>
                              Manage
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* ONBOARD */}
      {tab === "onboard" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <h2 className="uv-card-title">Onboard university + issuer</h2>
          <p className="uv-hint">Registers the university on-chain and assigns the issuer address in a single transaction.</p>
          <div style={{ marginTop: 14 }}>
            <label className="uv-label">Issuer wallet address</label>
            <input value={onboardIssuer} onChange={(e) => setOnboardIssuer(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
          </div>
          {uniFields(onboardUni, setOnboardUni)}
          <div className="uv-actions">
            <button onClick={() => void onboard()} disabled={isBusy} className="uv-btn uv-btn-primary">
              {txState !== "idle" ? `${txState}\u2026` : "Onboard (1 transaction)"}
            </button>
          </div>
        </div>
      )}

      {/* UPDATE UNIVERSITY */}
      {tab === "university" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <h2 className="uv-card-title">Update university</h2>
          <p className="uv-hint">Change university metadata or status. Metadata is stored in events; only status is in storage.</p>
          {uniFields(manageUni, setManageUni)}
          <div style={{ marginTop: 14 }}>
            <label className="uv-label">Status</label>
            <select value={manageStatus} onChange={(e) => setManageStatus(e.target.value)} className="uv-input" style={{ width: 200 }}>
              <option value="1">Active</option>
              <option value="2">Suspended</option>
              <option value="3">Revoked</option>
            </select>
          </div>
          <div className="uv-actions">
            <button onClick={() => void setUniversity()} disabled={isBusy} className="uv-btn uv-btn-primary">
              {txState !== "idle" ? `${txState}\u2026` : "Update university"}
            </button>
          </div>
        </div>
      )}

      {/* MANAGE ISSUER */}
      {tab === "issuer" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <h2 className="uv-card-title">Manage issuer</h2>
          <div style={{ display: "grid", gap: 12, marginTop: 14 }}>
            <div>
              <label className="uv-label">Issuer wallet address</label>
              <input value={issuerOpsAddress} onChange={(e) => setIssuerOpsAddress(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
            </div>
            <div>
              <label className="uv-label">Assign to university ID</label>
              <input value={assignUniversityId} onChange={(e) => setAssignUniversityId(e.target.value.trim())} placeholder="1001" className="uv-input uv-mono" style={{ width: 180 }} />
            </div>
          </div>
          <div className="uv-actions">
            <button onClick={() => void assignIssuer()} disabled={isBusy} className="uv-btn uv-btn-primary">
              {txState !== "idle" ? `${txState}\u2026` : "Assign to university"}
            </button>
            <button onClick={() => void removeIssuer()} disabled={isBusy} className="uv-btn uv-btn-danger">
              Remove issuer
            </button>
          </div>
          <p className="uv-hint">Assigning re-runs onboardIssuerAndUniversity \u2014 safe to use for existing universities.</p>
        </div>
      )}

      {/* OWNERSHIP */}
      {tab === "ownership" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <h2 className="uv-card-title">Ownership transfer (2-step)</h2>
          <p className="uv-hint">Transfer contract ownership safely. The new owner must accept before the transfer completes.</p>

          <div className="uv-kv" style={{ marginTop: 16, gap: "6px 16px" }}>
            <b>Current owner</b><code>{owner ?? "\u2014"}</code>
            <b>Pending owner</b>
            <code>
              {pendingOwner ?? <span className="uv-muted">None</span>}
            </code>
          </div>

          {/* Accept panel */}
          {isPendingOwner && (
            <div style={{ marginTop: 20, padding: 16, background: "var(--success-bg)", border: "1px solid var(--success)", borderRadius: 10 }}>
              <p style={{ margin: 0, fontWeight: 700, color: "var(--success)" }}>
                You are the pending owner. Accept to complete the transfer.
              </p>
              <div className="uv-actions" style={{ marginTop: 12 }}>
                <button onClick={() => void acceptOwnership()} disabled={isBusy} className="uv-btn uv-btn-primary">
                  {txState !== "idle" ? `${txState}\u2026` : "Accept ownership"}
                </button>
              </div>
            </div>
          )}

          {/* Transfer panel */}
          {isAdmin && (
            <div style={{ marginTop: 20 }}>
              <label className="uv-label">New owner address</label>
              <input value={transferTarget} onChange={(e) => setTransferTarget(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
              <div className="uv-actions">
                <button onClick={() => void transferOwnership()} disabled={isBusy} className="uv-btn uv-btn-danger">
                  {txState !== "idle" ? `${txState}\u2026` : "Initiate transfer"}
                </button>
              </div>
              <p className="uv-hint" style={{ marginTop: 8 }}>
                The new owner must connect their wallet and click &quot;Accept ownership&quot; to complete the transfer.
                Until then, you remain the owner.
              </p>
            </div>
          )}

          {!isAdmin && !isPendingOwner && account && (
            <p className="uv-hint" style={{ marginTop: 16 }}>
              You are neither the current owner nor the pending owner.
            </p>
          )}
        </div>
      )}

      {/* Status messages */}
      {txHash && (
        <div className="uv-status-banner uv-status-ok" style={{ marginTop: 12 }}>
          Tx confirmed: <code>{txHash}</code>
        </div>
      )}
      {error && <div className="uv-status-banner uv-status-fail" style={{ marginTop: 12 }}><b>Error:</b> {error}</div>}

      {logs.length > 0 && (
        <div className="uv-card uv-logs" style={{ marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Logs</h3>
            <button onClick={log.clear} className="uv-btn" style={{ fontSize: 12, padding: "4px 12px" }}>Clear</button>
          </div>
          <pre>
            {logs.map((line, idx) => <div key={idx}>{line}</div>)}
          </pre>
        </div>
      )}
    </main>
  );
}
