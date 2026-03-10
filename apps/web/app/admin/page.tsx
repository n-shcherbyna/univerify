"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";

import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readIsIssuer,
  readIssuerUniversityId,
  readOwner,
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
type Tab = "overview" | "onboard" | "university" | "issuer";

const EMPTY_UNI: UniversityForm = { id: "", name: "", country: "", website: "", accreditationId: "" };

const STATUS_BADGE: Record<number, { label: string; color: string; bg: string }> = {
  1: { label: "Active",    color: "#166534", bg: "#dcfce7" },
  2: { label: "Suspended", color: "#92400e", bg: "#fef3c7" },
  3: { label: "Revoked",   color: "#991b1b", bg: "#fee2e2" },
};
function StatusBadge({ status }: { status: number }) {
  const s = STATUS_BADGE[status] ?? { label: "Unknown", color: "#6b7280", bg: "#f3f4f6" };
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20, color: s.color, background: s.bg }}>
      {s.label}
    </span>
  );
}

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
      const o = await readOwner({ publicClient, registry: REGISTRY });
      setOwner(o);
      setIsAdmin(a.toLowerCase() === o.toLowerCase());
      await loadOverview();
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  async function runTx(fn: () => Promise<void>) {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can perform this action.");
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
      log.push(`Assign issuer=${issuerOpsAddress} → universityId=${universityId} (${meta.name})`);
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
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
  ];

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify — Admin</h1>
      <p className="uv-subtitle">Manage issuers and universities on-chain. Requires contract owner wallet.</p>

      {/* Wallet bar */}
      <div className="uv-card" style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          {account ? "Reconnect" : "Connect MetaMask"}
        </button>
        <div className="uv-kv" style={{ flex: 1, marginTop: 0, gap: "4px 16px" }}>
          <b>Account</b><code style={{ fontSize: 12 }}>{account || "—"}</code>
          <b>Owner</b><code style={{ fontSize: 12 }}>{owner ?? "—"}</code>
          <b>Access</b>
          <span style={{ fontWeight: 700, color: account ? (isAdmin ? "#166534" : "#b45309") : undefined }}>
            {account ? (isAdmin ? "✓ Owner" : "✗ Not owner") : "—"}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display: "flex", gap: 4, marginTop: 20, borderBottom: "1px solid var(--surface-border)" }}>
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: "8px 16px", fontSize: 14, fontWeight: tab === t.id ? 700 : 500,
              borderRadius: "8px 8px 0 0", border: "1px solid",
              borderBottom: tab === t.id ? "1px solid var(--surface)" : "1px solid var(--surface-border)",
              marginBottom: tab === t.id ? -1 : 0,
              background: tab === t.id ? "var(--surface)" : "transparent",
              borderColor: tab === t.id ? "var(--surface-border)" : "transparent",
              cursor: "pointer", color: "inherit",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === "overview" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="uv-card-title">Registry state</h2>
            <button onClick={() => void loadOverview()} disabled={overviewLoading} className="uv-btn" style={{ fontSize: 13 }}>
              {overviewLoading ? "Loading…" : "↺ Refresh"}
            </button>
          </div>

          {overviewError && <div className="uv-status-banner uv-status-fail" style={{ marginTop: 8 }}>{overviewError}</div>}

          {!overviewLoading && universities.length === 0 && issuers.length === 0 && (
            <p className="uv-hint" style={{ marginTop: 12 }}>No data. Click Refresh or connect wallet.</p>
          )}

          {universities.length > 0 && (
            <>
              <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 20, marginBottom: 8 }}>
                Universities <span className="uv-muted" style={{ fontWeight: 400 }}>({universities.length})</span>
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--surface-border)", textAlign: "left" }}>
                      <th style={{ padding: "6px 10px" }}>ID</th>
                      <th style={{ padding: "6px 10px" }}>Name</th>
                      <th style={{ padding: "6px 10px" }}>Country</th>
                      <th style={{ padding: "6px 10px" }}>Status</th>
                      <th style={{ padding: "6px 10px" }}>Accreditation</th>
                      <th style={{ padding: "6px 10px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {universities.map((u) => (
                      <tr key={u.universityId.toString()} style={{ borderBottom: "1px solid var(--surface-border)" }}>
                        <td style={{ padding: "8px 10px" }}><code>{u.universityId.toString()}</code></td>
                        <td style={{ padding: "8px 10px", fontWeight: 600 }}>{u.name}</td>
                        <td style={{ padding: "8px 10px" }}>{u.country || <span className="uv-muted">—</span>}</td>
                        <td style={{ padding: "8px 10px" }}><StatusBadge status={u.status} /></td>
                        <td style={{ padding: "8px 10px" }}>{u.accreditationId || <span className="uv-muted">—</span>}</td>
                        <td style={{ padding: "8px 10px" }}>
                          {isAdmin && (
                            <button onClick={() => prefillUniForm(u)} className="uv-btn" style={{ fontSize: 12, padding: "3px 10px" }}>
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
              <h3 style={{ fontSize: 14, fontWeight: 700, marginTop: 24, marginBottom: 8 }}>
                Issuers <span className="uv-muted" style={{ fontWeight: 400 }}>({issuers.filter(i => i.active).length} active / {issuers.length} total)</span>
              </h3>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid var(--surface-border)", textAlign: "left" }}>
                      <th style={{ padding: "6px 10px" }}>Address</th>
                      <th style={{ padding: "6px 10px" }}>University</th>
                      <th style={{ padding: "6px 10px" }}>Status</th>
                      <th style={{ padding: "6px 10px" }}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {issuers.map((iss) => (
                      <tr key={iss.issuer} style={{ borderBottom: "1px solid var(--surface-border)", opacity: iss.active ? 1 : 0.5 }}>
                        <td style={{ padding: "8px 10px" }}><code style={{ fontSize: 11 }}>{iss.issuer}</code></td>
                        <td style={{ padding: "8px 10px" }}>
                          {iss.universityName
                            ? <span><span className="uv-muted" style={{ fontSize: 11 }}>#{iss.universityId.toString()} </span>{iss.universityName}</span>
                            : <span className="uv-muted">—</span>}
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          <span style={{
                            fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 20,
                            color: iss.active ? "#166534" : "#6b7280",
                            background: iss.active ? "#dcfce7" : "#f3f4f6",
                          }}>
                            {iss.active ? "Active" : "Removed"}
                          </span>
                        </td>
                        <td style={{ padding: "8px 10px" }}>
                          {isAdmin && (
                            <button onClick={() => prefillIssuerForm(iss)} className="uv-btn" style={{ fontSize: 12, padding: "3px 10px" }}>
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

      {/* ── ONBOARD ── */}
      {tab === "onboard" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0 }}>
          <h2 className="uv-card-title">Onboard university + issuer</h2>
          <p className="uv-hint">Registers the university on-chain and assigns the issuer address in a single transaction.</p>
          <div style={{ marginTop: 14 }}>
            <label className="uv-label">Issuer wallet address</label>
            <input value={onboardIssuer} onChange={(e) => setOnboardIssuer(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
          </div>
          {uniFields(onboardUni, setOnboardUni)}
          <div className="uv-actions">
            <button onClick={() => void onboard()} disabled={isBusy} className="uv-btn uv-btn-primary">
              {txState !== "idle" ? `${txState}…` : "Onboard (1 transaction)"}
            </button>
          </div>
        </div>
      )}

      {/* ── UPDATE UNIVERSITY ── */}
      {tab === "university" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0 }}>
          <h2 className="uv-card-title">Update university</h2>
          <p className="uv-hint">Change university metadata or status. Metadata is stored in events; only status is in storage.</p>
          {uniFields(manageUni, setManageUni)}
          <div style={{ marginTop: 12 }}>
            <label className="uv-label">Status</label>
            <select value={manageStatus} onChange={(e) => setManageStatus(e.target.value)} className="uv-input" style={{ width: 200 }}>
              <option value="1">Active</option>
              <option value="2">Suspended</option>
              <option value="3">Revoked</option>
            </select>
          </div>
          <div className="uv-actions">
            <button onClick={() => void setUniversity()} disabled={isBusy} className="uv-btn uv-btn-primary">
              {txState !== "idle" ? `${txState}…` : "Update university"}
            </button>
          </div>
        </div>
      )}

      {/* ── MANAGE ISSUER ── */}
      {tab === "issuer" && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0 }}>
          <h2 className="uv-card-title">Manage issuer</h2>
          <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
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
              {txState !== "idle" ? `${txState}…` : "Assign to university"}
            </button>
            <button onClick={() => void removeIssuer()} disabled={isBusy} className="uv-btn uv-btn-danger">
              Remove issuer
            </button>
          </div>
          <p className="uv-hint">Assigning re-runs onboardIssuerAndUniversity — safe to use for existing universities.</p>
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
        <div className="uv-card" style={{ maxHeight: 220, overflowY: "auto", marginTop: 12 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h3 style={{ margin: 0, fontSize: 14 }}>Logs</h3>
            <button onClick={log.clear} className="uv-btn" style={{ fontSize: 12, padding: "4px 10px" }}>Clear</button>
          </div>
          <pre style={{ fontFamily: "monospace", fontSize: 12, marginTop: 8 }}>
            {logs.map((line, idx) => <div key={idx}>{line}</div>)}
          </pre>
        </div>
      )}
    </main>
  );
}
