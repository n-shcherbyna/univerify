"use client";

import { useState, useMemo, useEffect } from "react";
import { isAddress, encodeFunctionData, decodeFunctionData, type Address, type Hex } from "viem";
import { DiplomaRegistryAbi, TimelockControllerAbi, RegistryMultisigAbi } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readOwner,
  readRegistryOverview,
  type IssuerOverview,
  type UniversityOverview,
} from "@/lib/univerify/registry";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import type { ChainState, TxState } from "@/lib/univerify/types";
import {
  saltFor,
  hashOp,
  readMultisigInfo,
  readMultisigTx,
  readOperationState,
  type OperationState,
} from "@/lib/univerify/governance";
import {
  proposeChange,
  proposeSignerChange,
  confirmTx,
  revokeTx,
  execMultisig,
  execTimelock,
  cancelOp,
} from "@/lib/univerify/registryGovernanceWrite";

type UniversityForm = { id: string; name: string; country: string; website: string; accreditationId: string };
type Tab = "overview" | "governance";

type Bundle = Parameters<typeof proposeChange>[0];
type MultisigInfo = { owners: Address[]; threshold: bigint; txCount: bigint };
type PendingTx = Awaited<ReturnType<typeof readMultisigTx>>;
type TrackedOp = { label: string; registryData: Hex; salt: Hex; opId: Hex };
type ProposeAction = "onboard" | "university" | "removeIssuer";

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

/**
 * Human-readable label for a pending multisig tx. Two shapes: a wrapped
 * timelock.schedule/cancel (registry change), or a direct multisig self-call
 * (signer rotation: addOwner / removeOwner / changeThreshold).
 */
function decodeMultisigAction(data: Hex): string {
  try {
    const outer = decodeFunctionData({ abi: TimelockControllerAbi, data });
    if (outer.functionName === "schedule") {
      const innerData = outer.args[2] as Hex;
      try {
        const inner = decodeFunctionData({ abi: DiplomaRegistryAbi, data: innerData });
        return `${inner.functionName}(${(inner.args ?? []).map((a) => String(a)).join(", ")})`;
      } catch {
        return "schedule(…)";
      }
    }
    if (outer.functionName === "cancel") return `cancel(${String(outer.args[0])})`;
    return `${outer.functionName}(…)`;
  } catch {
    // Not a timelock call — try a multisig self-call (signer rotation).
    try {
      const self = decodeFunctionData({ abi: RegistryMultisigAbi, data });
      return `${self.functionName}(${(self.args ?? []).map((a) => String(a)).join(", ")})`;
    } catch {
      return "unknown action";
    }
  }
}

function opsStorageKey(registry: Address): string {
  return `uv-gov-ops-${registry.toLowerCase()}`;
}
function loadTrackedOps(registry: Address): TrackedOp[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(opsStorageKey(registry));
    return raw ? (JSON.parse(raw) as TrackedOp[]) : [];
  } catch {
    return [];
  }
}
function saveTrackedOps(registry: Address, ops: TrackedOp[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(opsStorageKey(registry), JSON.stringify(ops));
  } catch {
    /* ignore quota / disabled storage */
  }
}

function fmtCountdown(secondsLeft: number): string {
  if (secondsLeft <= 0) return "ready";
  const h = Math.floor(secondsLeft / 3600);
  const m = Math.floor((secondsLeft % 3600) / 60);
  const s = secondsLeft % 60;
  return [h, m, s].map((n) => String(n).padStart(2, "0")).join(":");
}

export default function AdminPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID, deployBlock: DEPLOY_BLOCK, multisig: MULTISIG, timelock: TIMELOCK } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL, TARGET_CHAIN_ID), [RPC_URL, TARGET_CHAIN_ID]);
  const governanceEnabled = MULTISIG !== null && TIMELOCK !== null;

  const [account, setAccount] = useState<Address | "">("");
  const [, setChainState] = useState<ChainState>("unknown");
  const [owner, setOwner] = useState<Address | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  // Overview state
  const [overviewLoading, setOverviewLoading] = useState(false);
  const [universities, setUniversities] = useState<UniversityOverview[]>([]);
  const [issuers, setIssuers] = useState<IssuerOverview[]>([]);
  const [overviewError, setOverviewError] = useState("");

  // Governance state
  const [multisigInfo, setMultisigInfo] = useState<MultisigInfo | null>(null);
  const [pendingTxs, setPendingTxs] = useState<PendingTx[]>([]);
  const [govLoading, setGovLoading] = useState(false);
  const [govError, setGovError] = useState("");
  const [trackedOps, setTrackedOps] = useState<TrackedOp[]>(() =>
    governanceEnabled ? loadTrackedOps(REGISTRY) : [],
  );
  const [opStates, setOpStates] = useState<Record<string, { state: OperationState; readyAt: bigint }>>({});
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));

  // Governance forms
  const [proposeAction, setProposeAction] = useState<ProposeAction>("onboard");
  const [proposeIssuer, setProposeIssuer] = useState("");
  const [proposeUni, setProposeUni] = useState<UniversityForm>(EMPTY_UNI);
  const [proposeStatus, setProposeStatus] = useState("1");

  // Signer-rotation forms
  const [addOwnerAddr, setAddOwnerAddr] = useState("");
  const [removeOwnerAddr, setRemoveOwnerAddr] = useState("");
  const [newThreshold, setNewThreshold] = useState("");

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);
  const isBusy = txState !== "idle";

  // Load governance data when the tab becomes active (and addresses configured).
  useEffect(() => {
    if (tab !== "governance" || !governanceEnabled) return;
    void loadGovernance();
    void loadOpStates();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, governanceEnabled]);

  // Live countdown tick while viewing the governance tab.
  useEffect(() => {
    if (tab !== "governance" || !governanceEnabled) return;
    const id = window.setInterval(() => setNowSeconds(Math.floor(Date.now() / 1000)), 1000);
    return () => window.clearInterval(id);
  }, [tab, governanceEnabled]);

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
    } catch (e: unknown) {
      setOverviewError(e instanceof Error ? e.message : String(e));
    } finally {
      setOverviewLoading(false);
    }
  }

  const isMultisigOwner = useMemo(
    () => !!account && !!multisigInfo && multisigInfo.owners.some((o) => o.toLowerCase() === (account as string).toLowerCase()),
    [account, multisigInfo],
  );

  async function loadGovernance() {
    if (!MULTISIG) return;
    setGovLoading(true);
    setGovError("");
    try {
      const info = await readMultisigInfo(publicClient, MULTISIG);
      setMultisigInfo(info);
      const txs: PendingTx[] = [];
      for (let i = 0n; i < info.txCount; i++) {
        txs.push(await readMultisigTx(publicClient, MULTISIG, i));
      }
      setPendingTxs(txs);
    } catch (e: unknown) {
      setGovError(e instanceof Error ? e.message : String(e));
    } finally {
      setGovLoading(false);
    }
  }

  async function loadOpStates(ops: TrackedOp[] = trackedOps) {
    if (!TIMELOCK || ops.length === 0) return;
    try {
      const entries = await Promise.all(
        ops.map(async (op) => [op.opId, await readOperationState(publicClient, TIMELOCK, op.opId)] as const),
      );
      setOpStates(Object.fromEntries(entries));
    } catch (e: unknown) {
      setGovError(e instanceof Error ? e.message : String(e));
    }
  }

  function addTrackedOp(op: TrackedOp) {
    setTrackedOps((prev) => {
      const next = [...prev.filter((o) => o.opId.toLowerCase() !== op.opId.toLowerCase()), op];
      saveTrackedOps(REGISTRY, next);
      return next;
    });
  }
  function forgetTrackedOp(opId: Hex) {
    setTrackedOps((prev) => {
      const next = prev.filter((o) => o.opId.toLowerCase() !== opId.toLowerCase());
      saveTrackedOps(REGISTRY, next);
      return next;
    });
  }

  function govBundle(): Bundle | null {
    if (!MULTISIG || !TIMELOCK || !account) return null;
    const eth = getEthereum();
    if (!eth) return null;
    const walletClient = makeWalletClient({ eth, account: account as Address, chainId: TARGET_CHAIN_ID });
    return { multisig: MULTISIG, timelock: TIMELOCK, registry: REGISTRY, account: account as Address, publicClient, walletClient, setTxState };
  }

  async function runGov(fn: (b: Bundle) => Promise<void>) {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!MULTISIG || !TIMELOCK) return setError("Governance addresses are not configured.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");
    const b = govBundle();
    if (!b) return setError("Could not build wallet client.");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      await fn(b);
      await loadGovernance();
      await loadOpStates();
    } catch (e: unknown) {
      setTxState("idle");
      const err = e instanceof Error ? e : null;
      setError((err as { shortMessage?: string } | null)?.shortMessage ?? err?.message ?? String(e));
    }
  }

  async function proposeRegistryChange() {
    if (!TIMELOCK) return setError("Governance addresses are not configured.");
    let registryData: Hex;
    let label: string;
    if (proposeAction === "onboard") {
      if (!isAddress(proposeIssuer)) return setError("Invalid issuer address.");
      if (!uniFormValid(proposeUni)) return setError("University ID and name are required.");
      registryData = encodeFunctionData({
        abi: DiplomaRegistryAbi,
        functionName: "onboardIssuerAndUniversity",
        args: [
          proposeIssuer as Address,
          BigInt(proposeUni.id.trim()),
          proposeUni.name.trim(),
          proposeUni.country.trim(),
          proposeUni.website.trim(),
          proposeUni.accreditationId.trim(),
        ],
      });
      label = `onboard-${proposeIssuer}-${Date.now()}`;
    } else if (proposeAction === "university") {
      if (!uniFormValid(proposeUni)) return setError("University ID and name are required.");
      if (!/^[123]$/.test(proposeStatus)) return setError("Invalid status.");
      registryData = encodeFunctionData({
        abi: DiplomaRegistryAbi,
        functionName: "setUniversity",
        args: [
          BigInt(proposeUni.id.trim()),
          Number(proposeStatus),
          proposeUni.name.trim(),
          proposeUni.country.trim(),
          proposeUni.website.trim(),
          proposeUni.accreditationId.trim(),
        ],
      });
      label = `university-${proposeUni.id.trim()}-${Date.now()}`;
    } else {
      if (!isAddress(proposeIssuer)) return setError("Invalid issuer address.");
      registryData = encodeFunctionData({
        abi: DiplomaRegistryAbi,
        functionName: "removeIssuer",
        args: [proposeIssuer as Address],
      });
      label = `removeIssuer-${proposeIssuer}-${Date.now()}`;
    }
    const salt = saltFor(label);
    await runGov(async (b) => {
      const delay = (await publicClient.readContract({
        address: TIMELOCK,
        abi: TimelockControllerAbi,
        functionName: "getMinDelay",
      })) as bigint;
      const opId = await hashOp(publicClient, TIMELOCK, REGISTRY, registryData, salt);
      log.push(`Propose ${proposeAction}: label=${label} delay=${delay.toString()}s opId=${opId}`);
      await proposeChange(b, registryData, salt, delay);
      addTrackedOp({ label, registryData, salt, opId });
      setProposeIssuer("");
      setProposeUni(EMPTY_UNI);
    });
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
      setOwner(await readOwner({ publicClient, registry: REGISTRY }));
      await loadOverview();
      if (governanceEnabled) {
        await loadGovernance();
        await loadOpStates();
      }
    } catch (e: unknown) {
      setChainState("wrong");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function proposeAddOwner() {
    if (!isAddress(addOwnerAddr)) return setError("Invalid owner address.");
    const data = encodeFunctionData({ abi: RegistryMultisigAbi, functionName: "addOwner", args: [addOwnerAddr as Address] });
    await runGov(async (b) => {
      log.push(`Propose addOwner(${addOwnerAddr})`);
      await proposeSignerChange(b, data);
      setAddOwnerAddr("");
    });
  }

  async function proposeRemoveOwner() {
    if (!isAddress(removeOwnerAddr)) return setError("Invalid owner address.");
    const data = encodeFunctionData({ abi: RegistryMultisigAbi, functionName: "removeOwner", args: [removeOwnerAddr as Address] });
    await runGov(async (b) => {
      log.push(`Propose removeOwner(${removeOwnerAddr})`);
      await proposeSignerChange(b, data);
      setRemoveOwnerAddr("");
    });
  }

  async function proposeChangeThreshold() {
    if (!/^\d+$/.test(newThreshold.trim()) || newThreshold.trim() === "0") return setError("Threshold must be a positive integer.");
    const value = BigInt(newThreshold.trim());
    if (multisigInfo && value > BigInt(multisigInfo.owners.length)) return setError("Threshold cannot exceed the number of owners.");
    const data = encodeFunctionData({ abi: RegistryMultisigAbi, functionName: "changeThreshold", args: [value] });
    await runGov(async (b) => {
      log.push(`Propose changeThreshold(${value.toString()})`);
      await proposeSignerChange(b, data);
      setNewThreshold("");
    });
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
    { id: "overview", label: "Overview" },
    ...(governanceEnabled ? [{ id: "governance" as Tab, label: "Governance" }] : []),
  ];

  return (
    <main className="uv-page">
      <h1 className="uv-title"><span className="uv-title-gradient">Admin</span></h1>
      <p className="uv-subtitle">Registry authorization is governed by the multisig + timelock. Changes are proposed and executed under the Governance tab.</p>

      {/* Wallet bar */}
      <div className="uv-card uv-wallet-bar">
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          {account ? "Reconnect" : "Connect MetaMask"}
        </button>
        <div className="uv-kv" style={{ flex: 1, marginTop: 0, gap: "4px 16px" }}>
          <b>Account</b><code>{account || "\u2014"}</code>
          <b>Owner</b><code>{owner ?? "\u2014"}</code>
          <b>Access</b>
          <span style={{ fontWeight: 700, color: account ? (isMultisigOwner ? "var(--success)" : "var(--warn)") : undefined }}>
            {account ? (isMultisigOwner ? "\u2713 Multisig owner" : "\u2717 Not a multisig owner") : "\u2014"}
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
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      {/* GOVERNANCE */}
      {tab === "governance" && governanceEnabled && (
        <div className="uv-card" style={{ marginTop: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <h2 className="uv-card-title">Governance</h2>
            <button onClick={() => { void loadGovernance(); void loadOpStates(); }} disabled={govLoading} className="uv-btn" style={{ fontSize: 13, padding: "6px 14px" }}>
              {govLoading ? "Loading…" : "↺ Refresh"}
            </button>
          </div>
          <p className="uv-hint">
            When the registry owner is the timelock, authorization changes are proposed to the multisig, confirmed by
            m-of-n owners, executed to schedule a timelock operation, then executed on-chain after the delay.
          </p>

          <div className="uv-kv" style={{ marginTop: 12, gap: "4px 16px" }}>
            <b>Multisig</b><code style={{ fontSize: 11 }}>{MULTISIG}</code>
            <b>Timelock</b><code style={{ fontSize: 11 }}>{TIMELOCK}</code>
            <b>Threshold</b>
            <span>{multisigInfo ? `${multisigInfo.threshold.toString()} of ${multisigInfo.owners.length}` : "—"}</span>
            <b>You</b>
            <span style={{ fontWeight: 700, color: account ? (isMultisigOwner ? "var(--success)" : "var(--warn)") : undefined }}>
              {account ? (isMultisigOwner ? "✓ Multisig owner" : "✗ Not a multisig owner") : "—"}
            </span>
          </div>

          {govError && <div className="uv-status-banner uv-status-fail" style={{ marginTop: 8 }}>{govError}</div>}

          {/* Section (a): Propose */}
          <h3 className="uv-section-heading">Propose change</h3>
          <div>
            <label className="uv-label">Action</label>
            <select
              value={proposeAction}
              onChange={(e) => setProposeAction(e.target.value as ProposeAction)}
              className="uv-input"
              style={{ width: 260 }}
            >
              <option value="onboard">Onboard issuer + university</option>
              <option value="university">Update university status</option>
              <option value="removeIssuer">Remove issuer</option>
            </select>
          </div>

          {(proposeAction === "onboard" || proposeAction === "removeIssuer") && (
            <div style={{ marginTop: 14 }}>
              <label className="uv-label">Issuer wallet address</label>
              <input value={proposeIssuer} onChange={(e) => setProposeIssuer(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
            </div>
          )}

          {(proposeAction === "onboard" || proposeAction === "university") && uniFields(proposeUni, setProposeUni)}

          {proposeAction === "university" && (
            <div style={{ marginTop: 14 }}>
              <label className="uv-label">Status</label>
              <select value={proposeStatus} onChange={(e) => setProposeStatus(e.target.value)} className="uv-input" style={{ width: 200 }}>
                <option value="1">Active</option>
                <option value="2">Suspended</option>
                <option value="3">Revoked</option>
              </select>
            </div>
          )}

          <div className="uv-actions">
            <button
              onClick={() => void proposeRegistryChange()}
              disabled={isBusy || !isMultisigOwner}
              className="uv-btn uv-btn-primary"
            >
              {txState !== "idle" ? `${txState}…` : "Propose to multisig"}
            </button>
          </div>
          {!isMultisigOwner && account && (
            <p className="uv-hint" style={{ marginTop: 8 }}>Only multisig owners can propose changes.</p>
          )}

          {/* Section (a2): Manage signers */}
          <h3 className="uv-section-heading">Manage signers</h3>
          <p className="uv-hint">
            Add or remove multisig owners, or change the confirmation threshold. These are self-governed:
            once m-of-n confirm and the tx is executed, the change applies immediately — no timelock delay.
          </p>
          <div style={{ display: "grid", gap: 16, marginTop: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px" }}>
                <label className="uv-label">Add owner</label>
                <input value={addOwnerAddr} onChange={(e) => setAddOwnerAddr(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
              </div>
              <button onClick={() => void proposeAddOwner()} disabled={isBusy || !isMultisigOwner} className="uv-btn uv-btn-primary">
                Propose add
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "1 1 320px" }}>
                <label className="uv-label">Remove owner</label>
                <input value={removeOwnerAddr} onChange={(e) => setRemoveOwnerAddr(e.target.value.trim())} placeholder="0x..." className="uv-input uv-mono" />
              </div>
              <button onClick={() => void proposeRemoveOwner()} disabled={isBusy || !isMultisigOwner} className="uv-btn uv-btn-danger">
                Propose remove
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div style={{ flex: "0 1 180px" }}>
                <label className="uv-label">
                  Threshold {multisigInfo && <span className="uv-muted">(now {multisigInfo.threshold.toString()} of {multisigInfo.owners.length})</span>}
                </label>
                <input value={newThreshold} onChange={(e) => setNewThreshold(e.target.value.trim())} placeholder="2" className="uv-input uv-mono" style={{ width: 120 }} />
              </div>
              <button onClick={() => void proposeChangeThreshold()} disabled={isBusy || !isMultisigOwner} className="uv-btn uv-btn-primary">
                Propose threshold
              </button>
            </div>
          </div>

          {/* Section (b): Pending multisig txs */}
          <h3 className="uv-section-heading">
            Pending multisig transactions <span className="uv-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({pendingTxs.filter((t) => !t.executed).length} open / {pendingTxs.length} total)</span>
          </h3>
          {pendingTxs.length === 0 ? (
            <p className="uv-hint">No transactions submitted yet.</p>
          ) : (
            <div className="uv-table-wrap">
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Action</th>
                    <th>Confirmations</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingTxs.map((t) => {
                    const ready = t.confirmations >= (multisigInfo?.threshold ?? 0n);
                    return (
                      <tr key={t.txId.toString()} style={{ opacity: t.executed ? 0.5 : 1 }}>
                        <td><code>{t.txId.toString()}</code></td>
                        <td style={{ fontSize: 12 }}><code>{decodeMultisigAction(t.data)}</code></td>
                        <td>{t.confirmations.toString()} / {multisigInfo?.threshold.toString() ?? "?"}</td>
                        <td>
                          <span className="uv-badge" style={{
                            color: t.executed ? "#166534" : ready ? "#92400e" : "#6b7280",
                            background: t.executed ? "#dcfce7" : ready ? "#fef3c7" : "#f3f4f6",
                          }}>
                            {t.executed ? "Executed" : ready ? "Ready" : "Pending"}
                          </span>
                        </td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button onClick={() => void runGov((b) => confirmTx(b, t.txId).then(() => {}))} disabled={isBusy || !isMultisigOwner || t.executed} className="uv-btn" style={{ fontSize: 12, padding: "4px 10px" }}>Confirm</button>{" "}
                          <button onClick={() => void runGov((b) => revokeTx(b, t.txId).then(() => {}))} disabled={isBusy || !isMultisigOwner || t.executed} className="uv-btn" style={{ fontSize: 12, padding: "4px 10px" }}>Revoke</button>{" "}
                          <button onClick={() => void runGov((b) => execMultisig(b, t.txId).then(() => {}))} disabled={isBusy || !isMultisigOwner || t.executed || !ready} className="uv-btn uv-btn-primary" style={{ fontSize: 12, padding: "4px 10px" }}>Execute</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* Section (c): Scheduled timelock ops */}
          <h3 className="uv-section-heading">
            Scheduled operations <span className="uv-muted" style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0 }}>({trackedOps.length})</span>
          </h3>
          {trackedOps.length === 0 ? (
            <p className="uv-hint">No tracked operations. Proposing a change adds one here.</p>
          ) : (
            <div className="uv-table-wrap">
              <table style={{ width: "100%" }}>
                <thead>
                  <tr>
                    <th>Label</th>
                    <th>State</th>
                    <th>Ready in</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {trackedOps.map((op) => {
                    const st = opStates[op.opId];
                    const state = st?.state ?? "Unset";
                    const secondsLeft = st ? Number(st.readyAt) - nowSeconds : 0;
                    return (
                      <tr key={op.opId}>
                        <td style={{ fontSize: 12 }}><code>{op.label}</code></td>
                        <td>
                          <span className="uv-badge" style={{
                            color: state === "Done" ? "#166534" : state === "Ready" ? "#92400e" : "#6b7280",
                            background: state === "Done" ? "#dcfce7" : state === "Ready" ? "#fef3c7" : "#f3f4f6",
                          }}>
                            {state}
                          </span>
                        </td>
                        <td><code>{state === "Pending" ? fmtCountdown(secondsLeft) : "—"}</code></td>
                        <td style={{ whiteSpace: "nowrap" }}>
                          <button onClick={() => void runGov((b) => execTimelock(b, op.registryData, op.salt).then(() => {}))} disabled={isBusy || state !== "Ready"} className="uv-btn uv-btn-primary" style={{ fontSize: 12, padding: "4px 10px" }}>Execute</button>{" "}
                          <button onClick={() => void runGov((b) => cancelOp(b, op.opId).then(() => {}))} disabled={isBusy || !isMultisigOwner || state !== "Pending"} className="uv-btn uv-btn-danger" style={{ fontSize: 12, padding: "4px 10px" }}>Cancel</button>{" "}
                          <button onClick={() => forgetTrackedOp(op.opId)} disabled={isBusy} className="uv-btn" style={{ fontSize: 12, padding: "4px 10px" }}>Forget</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
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
