"use client";

import { useEffect, useMemo, useState } from "react";
import { isAddress, isHex, type Address, type Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import {
  makePublicClient,
  readIsIssuer,
  readIssuerUniversityId,
  readOwner,
  readSnapshot,
  readUniversity,
} from "@/lib/univerify/registry";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import type { ChainState, TxState } from "@/lib/univerify/types";
import { writeIssuerAdminTx } from "@/lib/univerify/registryAdminWrite";

type CatalogResponse = {
  snapshotHash: Hex;
  universitiesCount: number;
};

const DEFAULT_CATALOG_PATH = "/catalog.snapshot.json";

function statusLabel(status: number): string {
  if (status === 1) return "Active";
  if (status === 2) return "Suspended";
  if (status === 3) return "Revoked";
  return "Unknown";
}

export default function AdminPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [owner, setOwner] = useState<Address | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);

  const [issuerAddress, setIssuerAddress] = useState("");
  const [issuerOpsInput, setIssuerOpsInput] = useState("");
  const [assignUniversityIdInput, setAssignUniversityIdInput] = useState("1001");
  const [universityIdInput, setUniversityIdInput] = useState("1001");
  const [officialNameInput, setOfficialNameInput] = useState("UniVerify University");
  const [countryInput, setCountryInput] = useState("PL");
  const [websiteInput, setWebsiteInput] = useState("");
  const [accreditationInput, setAccreditationInput] = useState("");
  const [manageUniversityIdInput, setManageUniversityIdInput] = useState("1001");
  const [manageUniversityStatusInput, setManageUniversityStatusInput] = useState("1");
  const [manageUniversityOfficialNameInput, setManageUniversityOfficialNameInput] = useState("");
  const [manageUniversityMetadataHashInput, setManageUniversityMetadataHashInput] = useState("");
  const [manageUniversityMetadataJsonInput, setManageUniversityMetadataJsonInput] = useState("");

  const [checkUniversityIdInput, setCheckUniversityIdInput] = useState("1001");

  const [catalogSnapshotHash, setCatalogSnapshotHash] = useState<Hex | null>(null);
  const [catalogUniversitiesCount, setCatalogUniversitiesCount] = useState<number>(0);

  const [txState, setTxState] = useState<TxState>("idle");
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const isBusy = txState !== "idle";

  const computedMetadataHash = useMemo(() => {
    if (!/^\d+$/.test(universityIdInput.trim()) || universityIdInput.trim() === "0") return null;
    if (!officialNameInput.trim()) return null;
    if (!countryInput.trim()) return null;

    const metadata: Record<string, unknown> = {
      universityId: Number(universityIdInput.trim()),
      officialName: officialNameInput.trim(),
      country: countryInput.trim().toUpperCase(),
    };
    if (websiteInput.trim()) metadata.website = websiteInput.trim();
    if (accreditationInput.trim()) metadata.accreditationId = accreditationInput.trim();

    return hashPayload(metadata) as Hex;
  }, [universityIdInput, officialNameInput, countryInput, websiteInput, accreditationInput]);

  const computedManageMetadataHash = useMemo(() => {
    const raw = manageUniversityMetadataJsonInput.trim();
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as unknown;
      return hashPayload(parsed) as Hex;
    } catch {
      return null;
    }
  }, [manageUniversityMetadataJsonInput]);

  function resetMessages() {
    setError("");
    setTxHash(null);
    log.clear();
  }

  async function refreshOwnerAndSnapshot(addr?: Address) {
    const [o, snap] = await Promise.all([
      readOwner({ publicClient, registry: REGISTRY }),
      readSnapshot({ publicClient, registry: REGISTRY }),
    ]);
    setOwner(o);

    const acc = addr ?? (account || null);
    const admin = !!acc && acc.toLowerCase() === o.toLowerCase();
    setIsAdmin(admin);

    log.push(`owner=${o}`);
    if (acc) log.push(`account=${acc} isAdmin=${admin}`);
    log.push(`snapshot.hash.onchain=${snap.hash}`);
  }

  async function loadCatalogInfo() {
    try {
      const res = await fetch("/api/catalog", { cache: "no-store" });
      if (!res.ok) throw new Error(`Catalog API failed (${res.status})`);
      const data = (await res.json()) as CatalogResponse;
      setCatalogSnapshotHash(data.snapshotHash);
      setCatalogUniversitiesCount(data.universitiesCount);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  useEffect(() => {
    void loadCatalogInfo();
  }, []);

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

      await refreshOwnerAndSnapshot(a);
      await loadCatalogInfo();
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  async function upsertCatalogAndGetSnapshotHash(params: {
    universityId: bigint;
    officialName: string;
    metadataHash: Hex;
  }): Promise<Hex> {
    const res = await fetch("/api/catalog", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        universityId: Number(params.universityId),
        officialName: params.officialName,
        metadataHash: params.metadataHash,
      }),
    });

    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error ?? `Catalog update failed (${res.status}).`);

    const snapshotHash = body?.snapshotHash as Hex;
    if (!isHex(snapshotHash, { strict: true }) || snapshotHash.length !== 66) {
      throw new Error("Catalog API returned invalid snapshotHash.");
    }

    setCatalogSnapshotHash(snapshotHash);
    setCatalogUniversitiesCount(Number(body?.universitiesCount ?? 0));
    return snapshotHash;
  }

  async function onboardUniversityAndIssuer() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can run onboarding.");
    if (!isAddress(issuerAddress)) return setError("Issuer address is invalid.");
    if (!/^\d+$/.test(universityIdInput.trim()) || universityIdInput.trim() === "0") {
      return setError("University ID must be a positive integer.");
    }
    if (!officialNameInput.trim()) return setError("Official university name is required.");
    if (!countryInput.trim()) return setError("Country is required.");
    if (!computedMetadataHash) return setError("Cannot compute metadata hash from provided data.");

    const universityId = BigInt(universityIdInput.trim());
    const metadataHash = computedMetadataHash;
    const officialName = officialNameInput.trim();

    const metadata: Record<string, unknown> = {
      universityId: Number(universityId),
      officialName,
      country: countryInput.trim().toUpperCase(),
    };
    if (websiteInput.trim()) metadata.website = websiteInput.trim();
    if (accreditationInput.trim()) metadata.accreditationId = accreditationInput.trim();

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });

      log.push("=== University onboarding flow ===");
      log.push(`issuer=${issuerAddress}`);
      log.push(`universityId=${universityId.toString()}`);
      log.push(`officialName=${officialName}`);
      log.push(`metadataHash=${metadataHash}`);

      log.push(`step1=updateCatalog(${DEFAULT_CATALOG_PATH})`);
      log.push(`catalog.metadata=${JSON.stringify(metadata)}`);
      const newSnapshotHash = await upsertCatalogAndGetSnapshotHash({
        universityId,
        officialName,
        metadataHash,
      });
      log.push(`catalog.snapshotHash=${newSnapshotHash}`);

      log.push("step2=onboardIssuerAndUniversity(one tx)");
      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer: issuerAddress as Address,
        universityId,
        universityMetadataHash: metadataHash,
        snapshotHash: newSnapshotHash,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });

      await refreshOwnerAndSnapshot();
      log.push("RESULT=ONBOARDING_OK");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setTxState("idle");
      setError(err.shortMessage ?? err.message ?? String(e));
      log.push(`ERROR=${err.shortMessage ?? err.message ?? String(e)}`);
    }
  }

  async function checkIssuer() {
    resetMessages();
    if (!isAddress(issuerOpsInput)) return setError("Enter a valid issuer address.");
    try {
      const issuer = issuerOpsInput as Address;
      const [ok, uid] = await Promise.all([
        readIsIssuer({ publicClient, registry: REGISTRY, issuer }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer }),
      ]);
      log.push(`isIssuer=${ok}`);
      log.push(`issuerUniversityId=${uid.toString()}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function checkUniversity() {
    resetMessages();
    if (!/^\d+$/.test(checkUniversityIdInput.trim()) || checkUniversityIdInput.trim() === "0") {
      return setError("University ID must be a positive integer.");
    }
    try {
      const uni = await readUniversity({
        publicClient,
        registry: REGISTRY,
        universityId: BigInt(checkUniversityIdInput.trim()),
      });
      log.push(`university.metadataHash=${uni.metadataHash}`);
      log.push(`university.status=${uni.status} (${statusLabel(uni.status)})`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function removeIssuer() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can remove issuer.");
    if (!isAddress(issuerOpsInput)) return setError("Issuer address is invalid.");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });
      const issuer = issuerOpsInput as Address;

      log.push("=== Remove issuer flow ===");
      log.push(`issuer=${issuer}`);

      await writeIssuerAdminTx({
        fn: "removeIssuer",
        issuer,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });

      const [ok, uid] = await Promise.all([
        readIsIssuer({ publicClient, registry: REGISTRY, issuer }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer }),
      ]);
      log.push(`isIssuer.after=${ok}`);
      log.push(`issuerUniversityId.after=${uid.toString()}`);
      log.push("RESULT=REMOVE_ISSUER_OK");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setTxState("idle");
      setError(err.shortMessage ?? err.message ?? String(e));
      log.push(`ERROR=${err.shortMessage ?? err.message ?? String(e)}`);
    }
  }

  async function assignIssuerOnChainOnly() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can assign issuer.");
    if (!isAddress(issuerOpsInput)) return setError("Issuer address is invalid.");
    if (!/^\d+$/.test(assignUniversityIdInput.trim()) || assignUniversityIdInput.trim() === "0") {
      return setError("University ID must be a positive integer.");
    }

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });
      const issuer = issuerOpsInput as Address;
      const universityId = BigInt(assignUniversityIdInput.trim());

      const [uni, snap] = await Promise.all([
        readUniversity({ publicClient, registry: REGISTRY, universityId }),
        readSnapshot({ publicClient, registry: REGISTRY }),
      ]);

      if (uni.metadataHash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return setError("University metadataHash is empty on-chain. Initialize university first.");
      }
      if (snap.hash === "0x0000000000000000000000000000000000000000000000000000000000000000") {
        return setError("snapshotHash is empty on-chain. Run onboarding flow first.");
      }

      log.push("=== Assign issuer (on-chain only) ===");
      log.push(`issuer=${issuer}`);
      log.push(`universityId=${universityId.toString()}`);
      log.push(`university.metadataHash.onchain=${uni.metadataHash}`);
      log.push(`snapshot.hash.onchain=${snap.hash}`);

      await writeIssuerAdminTx({
        fn: "onboardIssuerAndUniversity",
        issuer,
        universityId,
        universityMetadataHash: uni.metadataHash,
        snapshotHash: snap.hash,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });

      const [ok, uid] = await Promise.all([
        readIsIssuer({ publicClient, registry: REGISTRY, issuer }),
        readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer }),
      ]);
      log.push(`isIssuer.after=${ok}`);
      log.push(`issuerUniversityId.after=${uid.toString()}`);
      log.push("RESULT=ASSIGN_ISSUER_ONCHAIN_OK");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setTxState("idle");
      setError(err.shortMessage ?? err.message ?? String(e));
      log.push(`ERROR=${err.shortMessage ?? err.message ?? String(e)}`);
    }
  }

  async function setUniversityOnChain() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAdmin) return setError("Only contract owner can set university.");
    if (!/^\d+$/.test(manageUniversityIdInput.trim()) || manageUniversityIdInput.trim() === "0") {
      return setError("University ID must be a positive integer.");
    }
    if (!/^[123]$/.test(manageUniversityStatusInput)) {
      return setError("University status must be: 1=Active, 2=Suspended, 3=Revoked.");
    }

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });

      const universityId = BigInt(manageUniversityIdInput.trim());
      const nextStatus = Number(manageUniversityStatusInput);
      const current = await readUniversity({ publicClient, registry: REGISTRY, universityId });

      const metadataHash = manageUniversityMetadataHashInput.trim()
        ? (manageUniversityMetadataHashInput.trim() as Hex)
        : current.metadataHash;
      if (!isHex(metadataHash, { strict: true }) || metadataHash.length !== 66) {
        return setError("metadataHash must be bytes32 hex.");
      }
      const metadataChanged = metadataHash.toLowerCase() !== current.metadataHash.toLowerCase();

      log.push("=== Set university (on-chain) ===");
      log.push(`universityId=${universityId.toString()}`);
      log.push(`status.before=${current.status} (${statusLabel(current.status)})`);
      log.push(`status.after=${nextStatus} (${statusLabel(nextStatus)})`);
      log.push(`metadataHash.before=${current.metadataHash}`);
      log.push(`metadataHash.after=${metadataHash}`);
      log.push(`metadata.changed=${metadataChanged ? "YES" : "NO"}`);

      if (metadataChanged) {
        if (!manageUniversityOfficialNameInput.trim()) {
          return setError("Official name is required when metadataHash changes (catalog must be updated).");
        }
        log.push("step1=updateCatalog");
        const newSnapshotHash = await upsertCatalogAndGetSnapshotHash({
          universityId,
          officialName: manageUniversityOfficialNameInput.trim(),
          metadataHash,
        });
        log.push(`catalog.snapshotHash=${newSnapshotHash}`);
        log.push("step2=setUniversityAndSnapshot(one tx)");
        await writeIssuerAdminTx({
          fn: "setUniversityAndSnapshot",
          universityId,
          universityStatus: nextStatus,
          universityMetadataHash: metadataHash,
          snapshotHash: newSnapshotHash,
          registry: REGISTRY,
          account,
          publicClient,
          walletClient,
          setTxState,
          onTxHash: setTxHash,
        });
      } else {
        log.push("step1=setUniversity(one tx)");
        await writeIssuerAdminTx({
          fn: "setUniversity",
          universityId,
          universityStatus: nextStatus,
          universityMetadataHash: metadataHash,
          registry: REGISTRY,
          account,
          publicClient,
          walletClient,
          setTxState,
          onTxHash: setTxHash,
        });
      }

      const uniAfter = await readUniversity({ publicClient, registry: REGISTRY, universityId });
      log.push(`status.after.onchain=${uniAfter.status} (${statusLabel(uniAfter.status)})`);
      log.push(`metadataHash.after.onchain=${uniAfter.metadataHash}`);
      log.push("RESULT=SET_UNIVERSITY_ONCHAIN_OK");
    } catch (e: unknown) {
      const err = e as { shortMessage?: string; message?: string };
      setTxState("idle");
      setError(err.shortMessage ?? err.message ?? String(e));
      log.push(`ERROR=${err.shortMessage ?? err.message ?? String(e)}`);
    }
  }

  function applyComputedManageMetadataHash() {
    if (!computedManageMetadataHash) {
      setError("Metadata JSON is invalid. Provide valid JSON first.");
      return;
    }
    setManageUniversityMetadataHashInput(computedManageMetadataHash);
    setError("");
    log.push(`metadataHash.computed=${computedManageMetadataHash}`);
  }

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify - Admin</h1>
      <p className="uv-subtitle">Operational management for issuers, universities, and on-chain trust consistency.</p>

      <div className="uv-card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          Connect MetaMask
        </button>
        <div className="uv-kv" style={{ marginTop: 0 }}>
          <b>Account</b><span>{account || "-"}</span>
          <b>Network</b><span>{chainState === "ok" ? "OK" : chainState === "wrong" ? "Wrong network" : "-"}</span>
          <b>Registry</b><code>{REGISTRY}</code>
          <b>Owner</b><code>{owner ?? "-"}</code>
          <b>Is admin</b><span style={{ color: isAdmin ? "#166534" : "#b45309" }}>{isAdmin ? "YES" : "NO"}</span>
          <b>Catalog file</b><code>{DEFAULT_CATALOG_PATH}</code>
          <b>Catalog entries</b><span>{catalogUniversitiesCount}</span>
          <b>Catalog snapshot hash</b><code>{catalogSnapshotHash ?? "-"}</code>
        </div>
      </div>

      <div className="uv-card">
        <h2 className="uv-card-title">Operations</h2>
        <p className="uv-hint">Grouped by workflow to keep day-to-day tasks concise and predictable.</p>

        <details className="uv-details" open>
          <summary>Primary Workflow: Onboard University + Issuer</summary>
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Issuer address</label>
          <input
            value={issuerAddress}
            onChange={(e) => setIssuerAddress(e.target.value.trim())}
            placeholder="0x..."
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>University ID (uint64)</label>
          <input
            value={universityIdInput}
            onChange={(e) => setUniversityIdInput(e.target.value.trim())}
            placeholder="1001"
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Official name</label>
          <input
            value={officialNameInput}
            onChange={(e) => setOfficialNameInput(e.target.value)}
            placeholder="UniVerify University"
            style={{ width: "100%", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Country (ISO)</label>
          <input
            value={countryInput}
            onChange={(e) => setCountryInput(e.target.value)}
            placeholder="PL"
            style={{ width: "100%", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Website (optional)</label>
          <input
            value={websiteInput}
            onChange={(e) => setWebsiteInput(e.target.value)}
            placeholder="https://..."
            style={{ width: "100%", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Accreditation ID (optional)</label>
          <input
            value={accreditationInput}
            onChange={(e) => setAccreditationInput(e.target.value)}
            placeholder="PL-ACC-2026-001"
            style={{ width: "100%", padding: 10 }}
          />
          <p style={{ marginTop: 10 }}>
            <b>Computed metadataHash:</b> <code>{computedMetadataHash ?? "-"}</code>
          </p>
          <div className="uv-actions">
            <button onClick={() => void onboardUniversityAndIssuer()} disabled={isBusy} className="uv-btn uv-btn-primary">
              Run onboarding flow
            </button>
          </div>
        </details>

        <details className="uv-details">
          <summary>Primary Workflow: Manage University Status / Metadata</summary>
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>University ID</label>
          <input
            value={manageUniversityIdInput}
            onChange={(e) => setManageUniversityIdInput(e.target.value.trim())}
            placeholder="1001"
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Status</label>
          <select
            value={manageUniversityStatusInput}
            onChange={(e) => setManageUniversityStatusInput(e.target.value)}
            style={{ width: "100%", padding: 10 }}
          >
            <option value="1">1 - Active</option>
            <option value="2">2 - Suspended</option>
            <option value="3">3 - Revoked</option>
          </select>
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>
            Official name (required only when metadata changes)
          </label>
          <input
            value={manageUniversityOfficialNameInput}
            onChange={(e) => setManageUniversityOfficialNameInput(e.target.value)}
            placeholder="UniVerify University"
            style={{ width: "100%", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>
            Metadata hash (optional)
          </label>
          <input
            value={manageUniversityMetadataHashInput}
            onChange={(e) => setManageUniversityMetadataHashInput(e.target.value.trim())}
            placeholder="0x... (leave empty to keep current on-chain value)"
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>
            Metadata JSON (optional, for auto-hash)
          </label>
          <textarea
            value={manageUniversityMetadataJsonInput}
            onChange={(e) => setManageUniversityMetadataJsonInput(e.target.value)}
            placeholder='{"officialName":"UniVerify University","country":"PL"}'
            rows={6}
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <p style={{ marginTop: 10 }}>
            <b>Computed metadataHash:</b> <code>{computedManageMetadataHash ?? "-"}</code>
          </p>
          <div className="uv-actions">
            <button onClick={applyComputedManageMetadataHash} disabled={isBusy} className="uv-btn">
              Use computed hash
            </button>
            <button onClick={() => void setUniversityOnChain()} disabled={isBusy} className="uv-btn uv-btn-primary">
              Set university on-chain
            </button>
          </div>
        </details>

        <details className="uv-details">
          <summary>Issuer Operations</summary>
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Issuer address</label>
          <input
            value={issuerOpsInput}
            onChange={(e) => setIssuerOpsInput(e.target.value.trim())}
            placeholder="0x..."
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Assign to university ID</label>
          <input
            value={assignUniversityIdInput}
            onChange={(e) => setAssignUniversityIdInput(e.target.value.trim())}
            placeholder="1001"
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <div className="uv-actions">
            <button onClick={() => void checkIssuer()} disabled={isBusy} className="uv-btn">Check issuer</button>
            <button onClick={() => void assignIssuerOnChainOnly()} disabled={isBusy} className="uv-btn">
              Assign issuer on-chain
            </button>
          </div>

          <p className="uv-hint">The same issuer address is reused for check, assign, and remove actions.</p>
          <div className="uv-actions">
            <button onClick={() => void removeIssuer()} disabled={isBusy} className="uv-btn uv-btn-danger">
              Remove issuer
            </button>
          </div>
        </details>

        <details className="uv-details">
          <summary>Diagnostics</summary>
          <label style={{ display: "block", fontWeight: 600, marginTop: 10, marginBottom: 8 }}>Check university ID</label>
          <input
            value={checkUniversityIdInput}
            onChange={(e) => setCheckUniversityIdInput(e.target.value.trim())}
            placeholder="1001"
            style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
          />
          <div className="uv-actions">
            <button onClick={() => void checkUniversity()} disabled={isBusy} className="uv-btn">Check university</button>
          </div>
        </details>
      </div>

      {(txState !== "idle" || txHash) && (
        <div className="uv-status-banner uv-status-ok">
          {txState !== "idle" && <p><b>Tx state:</b> {txState}</p>}
          {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}
        </div>
      )}
      {error && (
        <div className="uv-status-banner uv-status-fail">
          <b>Error:</b> {error}
        </div>
      )}

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
