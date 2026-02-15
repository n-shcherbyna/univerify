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
  const [universityIdInput, setUniversityIdInput] = useState("1001");
  const [officialNameInput, setOfficialNameInput] = useState("UniVerify University");
  const [countryInput, setCountryInput] = useState("PL");
  const [websiteInput, setWebsiteInput] = useState("");
  const [accreditationInput, setAccreditationInput] = useState("");

  const [checkIssuerInput, setCheckIssuerInput] = useState("");
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

  function resetMessages() {
    setError("");
    setTxHash(null);
    log.clear();
  }

  async function refreshOwnerAndSnapshot(addr?: Address) {
    const o = await readOwner({ publicClient, registry: REGISTRY });
    setOwner(o);

    const acc = addr ?? (account || null);
    const admin = !!acc && acc.toLowerCase() === o.toLowerCase();
    setIsAdmin(admin);

    const snap = await readSnapshot({ publicClient, registry: REGISTRY });
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
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`ERROR=${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function checkIssuer() {
    resetMessages();
    if (!isAddress(checkIssuerInput)) return setError("Enter a valid issuer address.");
    try {
      const issuer = checkIssuerInput as Address;
      const ok = await readIsIssuer({ publicClient, registry: REGISTRY, issuer });
      const uid = await readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer });
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

  return (
    <main style={{ maxWidth: 980, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Admin</h1>

      <div className="uv-card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          Connect MetaMask
        </button>
        <div>
          <div><b>Account:</b> {account || "-"}</div>
          <div><b>Network:</b> {chainState === "ok" ? "OK" : chainState === "wrong" ? "Wrong network" : "-"}</div>
          <div><b>Registry:</b> <code>{REGISTRY}</code></div>
          <div><b>Owner:</b> <code>{owner ?? "-"}</code></div>
          <div><b>Is admin:</b> <span style={{ color: isAdmin ? "green" : "orange" }}>{isAdmin ? "YES" : "NO"}</span></div>
          <div><b>Catalog file:</b> <code>{DEFAULT_CATALOG_PATH}</code></div>
          <div><b>Catalog entries:</b> {catalogUniversitiesCount}</div>
          <div><b>Catalog snapshot hash:</b> <code>{catalogSnapshotHash ?? "-"}</code></div>
        </div>
      </div>

      <div className="uv-card">
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Quick Onboarding (University + Issuer + Catalog)</h2>
        <p style={{ marginTop: 6 }}>
          One flow updates the catalog file and submits one on-chain onboarding transaction.
        </p>

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
      </div>

      <div className="uv-card">
        <h2 style={{ fontSize: 20, fontWeight: 700 }}>Quick Checks</h2>

        <label style={{ display: "block", fontWeight: 600, marginTop: 8, marginBottom: 8 }}>Check issuer</label>
        <input
          value={checkIssuerInput}
          onChange={(e) => setCheckIssuerInput(e.target.value.trim())}
          placeholder="0x..."
          style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
        />
        <div className="uv-actions">
          <button onClick={() => void checkIssuer()} disabled={isBusy} className="uv-btn">Check issuer</button>
        </div>

        <label style={{ display: "block", fontWeight: 600, marginTop: 12, marginBottom: 8 }}>Check university ID</label>
        <input
          value={checkUniversityIdInput}
          onChange={(e) => setCheckUniversityIdInput(e.target.value.trim())}
          placeholder="1001"
          style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
        />
        <div className="uv-actions">
          <button onClick={() => void checkUniversity()} disabled={isBusy} className="uv-btn">Check university</button>
        </div>
      </div>

      {txState !== "idle" && (
        <p style={{ marginTop: 10 }}>
          <b>Tx state:</b> {txState}
        </p>
      )}
      {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}
      {error && <p style={{ color: "red" }}><b>Error:</b> {error}</p>}

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
    </main>
  );
}
