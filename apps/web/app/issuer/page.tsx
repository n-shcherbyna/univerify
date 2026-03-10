"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";
import { hashPayload } from "@univerify/verifier-core";

import { readPublicEnv } from "@/lib/univerify/env";
import type { ChainState, TxState, DiplomaEnvelopeMerkleBatch } from "@/lib/univerify/types";
import { buildUniVerifyDomain, recoverIssuerFromEip712, DIPLOMA_TYPES } from "@/lib/univerify/eip712";
import { makePublicClient, readIsRevoked, readIssuerUniversityId, readUniversityMeta, readStatusWithProof, statusLabel } from "@/lib/univerify/registry";
import { downloadJson, parseJson } from "@/lib/univerify/json";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import { writeIssueBatchRootTx } from "@/lib/univerify/registryWrite";
import { buildMerkleFromLeaves, computeMerkleLeaf } from "@/lib/univerify/merkle";

const UINT64_MAX = (1n << 64n) - 1n;

type BatchItem = {
  index: number;
  payload: unknown;
  docHash: Hex;
  leaf: Hex;
  proof: Hex[];
};

type ComputedBatch = {
  batchIdBigint: bigint;
  batchIdNumber: number;
  merkleRoot: Hex;
  items: BatchItem[];
};

export default function IssuerPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID, deployBlock: DEPLOY_BLOCK } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");
  const [attachEip712, setAttachEip712] = useState(false);
  const [signature, setSignature] = useState<Hex | null>(null);
  const [accountUniversityId, setAccountUniversityId] = useState<bigint | null>(null);
  const [accountUniversityName, setAccountUniversityName] = useState<string | null>(null);

  const [batchPayloadsText, setBatchPayloadsText] = useState(
    `[
  {
    "student": { "firstName": "Jan", "lastName": "Kowalski", "studentId": "s123456" },
    "degree": { "name": "Bachelor of Computer Science", "level": "BSc" },
    "issuedAt": "2025-06-30",
    "diplomaNumber": "UV-2025-000123"
  },
  {
    "student": { "firstName": "Anna", "lastName": "Nowak", "studentId": "s123457" },
    "degree": { "name": "Bachelor of Computer Science", "level": "BSc" },
    "issuedAt": "2025-06-30",
    "diplomaNumber": "UV-2025-000124"
  }
]`.trim()
  );
  const [batchIdInput, setBatchIdInput] = useState("1");
  const [selectedItemIndex, setSelectedItemIndex] = useState(0);
  const [computedBatch, setComputedBatch] = useState<ComputedBatch | null>(null);

  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [error, setError] = useState("");
  const [selectedChainStatus, setSelectedChainStatus] = useState<"Unknown" | "Valid" | "Revoked" | "-">("-");
  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const isBusy = txState !== "idle";
  const hasWallet = !!account;

  const selectedItem = useMemo(() => {
    if (!computedBatch) return null;
    if (selectedItemIndex < 0 || selectedItemIndex >= computedBatch.items.length) return null;
    return computedBatch.items[selectedItemIndex];
  }, [computedBatch, selectedItemIndex]);

  function resetMessages() {
    setError("");
    setTxHash(null);
  }

  async function refreshSelectedStatusFromChain() {
    if (!computedBatch || !selectedItem || !account) return;
    const code = await readStatusWithProof({
      publicClient,
      registry: REGISTRY,
      docHash: selectedItem.docHash,
      issuer: account,
      batchId: computedBatch.batchIdBigint,
      proof: selectedItem.proof,
    });
    const label = statusLabel(code);
    setSelectedChainStatus(label);

    const revoked = await readIsRevoked({
      publicClient,
      registry: REGISTRY,
      docHash: selectedItem.docHash,
      issuer: account,
      batchId: computedBatch.batchIdBigint,
    });
    log.push(`selected.chain.status=${code} (${label})`);
    log.push(`selected.revoked=${revoked === null ? "UNAVAILABLE (old contract ABI)" : String(revoked)}`);
  }

  function parseBatchId(input: string): { batchIdBigint: bigint; batchIdNumber: number } {
    if (!/^\d+$/.test(input.trim())) throw new Error("Batch ID must be a non-negative integer.");
    const batchIdBigint = BigInt(input.trim());
    if (batchIdBigint > UINT64_MAX) throw new Error("Batch ID exceeds uint64 range.");
    if (batchIdBigint > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Batch ID must be <= ${Number.MAX_SAFE_INTEGER} for safe JSON encoding.`);
    }
    return { batchIdBigint, batchIdNumber: Number(batchIdBigint) };
  }

  async function connect() {
    resetMessages();
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh the page.");
    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) return setError(`Invalid address returned by wallet: ${addr}`);
      setAccount(addr as Address);
      log.push(`wallet connected: ${addr}`);
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      log.push(`network ok (chainId=${TARGET_CHAIN_ID})`);
      const uid = await readIssuerUniversityId({ publicClient, registry: REGISTRY, issuer: addr as Address });
      setAccountUniversityId(uid === 0n ? null : uid);
      if (uid > 0n) {
        const meta = await readUniversityMeta({ publicClient, registry: REGISTRY, universityId: uid, fromBlock: DEPLOY_BLOCK });
        setAccountUniversityName(meta?.name || null);
        log.push(`issuer.universityId=${uid.toString()} name=${meta?.name ?? "unknown"}`);
      } else {
        setAccountUniversityName(null);
        log.push(`issuer.universityId=0 (not registered)`);
      }
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
      log.push(`connect error: ${e?.message ?? String(e)}`);
    }
  }

  function computeBatch() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (accountUniversityId === null) return setError("Connected wallet is not configured as issuer (missing universityId).");

    try {
      const parsed = parseJson<unknown[]>(batchPayloadsText);
      if (!parsed.ok) throw new Error(parsed.error);
      if (!Array.isArray(parsed.value) || parsed.value.length === 0) throw new Error("Batch payload JSON must be a non-empty array.");

      const { batchIdBigint, batchIdNumber } = parseBatchId(batchIdInput);
      const chainId = BigInt(TARGET_CHAIN_ID);
      const docHashes = parsed.value.map((payload) => hashPayload(payload));
      const leaves = docHashes.map((docHash) =>
        computeMerkleLeaf({
          registry: REGISTRY,
          chainId,
          issuer: account,
          batchId: batchIdBigint,
          docHash,
        })
      );
      const { root, proofs } = buildMerkleFromLeaves(leaves);

      const items: BatchItem[] = parsed.value.map((payload, index) => ({
        index,
        payload,
        docHash: docHashes[index],
        leaf: leaves[index],
        proof: proofs[index],
      }));

      setComputedBatch({
        batchIdBigint,
        batchIdNumber,
        merkleRoot: root,
        items,
      });
      setSelectedItemIndex(0);
      setSignature(null);
      setSelectedChainStatus("-");

      log.push("=== batch computed ===");
      log.push(`batchId=${batchIdBigint.toString()}, items=${items.length}`);
      log.push(`issuer=${account}, registry=${REGISTRY}, chainId=${TARGET_CHAIN_ID}`);
      log.push(`merkleRoot=${root}`);
      log.push(`item[0].docHash=${items[0].docHash}`);
      log.push(`item[0].leaf=${items[0].leaf}`);
      log.push(`item[0].proofNodes=${items[0].proof.length}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
      log.push(`compute batch error: ${e?.message ?? String(e)}`);
    }
  }

  async function issueBatchRootTx() {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!computedBatch) return setError("Compute batch first.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");
      const walletClient = makeWalletClient({ eth, account });
      await writeIssueBatchRootTx({
        batchId: computedBatch.batchIdBigint,
        merkleRoot: computedBatch.merkleRoot,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
      });
      log.push(`batch root issued on-chain: batchId=${computedBatch.batchIdBigint.toString()}, root=${computedBatch.merkleRoot}`);
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`issue root error: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    }
  }

  async function signDocHash() {
    resetMessages();
    if (!attachEip712) return setError("Enable optional EIP-712 signature first.");
    if (!selectedItem) return setError("Select batch item first.");
    if (!account) return setError("Connect MetaMask first.");
    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    setTxState("signing");
    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      const walletClient = makeWalletClient({ eth, account });
      const domain = buildUniVerifyDomain({ chainId: TARGET_CHAIN_ID, registry: REGISTRY });
      const sig = await walletClient.signTypedData({
        account,
        domain,
        types: DIPLOMA_TYPES,
        primaryType: "Diploma",
        message: { docHash: selectedItem.docHash },
      });
      const recovered = await recoverIssuerFromEip712({ docHash: selectedItem.docHash, signature: sig, domain });
      if (recovered.toLowerCase() !== account.toLowerCase()) {
        throw new Error("EIP-712 recovered address mismatch.");
      }
      setSignature(sig);
      log.push(`optional EIP-712 signature created: docHash=${selectedItem.docHash}`);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? String(e));
      log.push(`sign error: ${e?.shortMessage ?? e?.message ?? String(e)}`);
    } finally {
      setTxState("idle");
    }
  }

  function exportSelectedProof() {
    resetMessages();
    if (!computedBatch || !selectedItem) return setError("Select batch item first.");
    if (!account) return setError("Connect MetaMask first.");
    downloadJson(`univerify-batch-proof-${selectedItem.docHash}.json`, {
      issuer: account,
      batchId: computedBatch.batchIdNumber,
      merkleRoot: computedBatch.merkleRoot,
      docHash: selectedItem.docHash,
      leaf: selectedItem.leaf,
      proof: selectedItem.proof,
      index: selectedItem.index,
    });
    log.push(`proof exported: index=${selectedItem.index}, docHash=${selectedItem.docHash}, proofNodes=${selectedItem.proof.length}`);
  }

  function exportDiplomaJson() {
    resetMessages();
    if (!computedBatch || !selectedItem) return setError("Select batch item first.");
    if (!account) return setError("Connect MetaMask first.");
    if (attachEip712 && !signature) return setError("Sign docHash first.");

    const domain = buildUniVerifyDomain({ chainId: TARGET_CHAIN_ID, registry: REGISTRY });
    const envelope: DiplomaEnvelopeMerkleBatch = {
      payload: selectedItem.payload,
      proof: {
        type: "MERKLE_BATCH",
        batchId: computedBatch.batchIdNumber,
        proof: selectedItem.proof,
        issuer: account,
        eip712: attachEip712 && signature
          ? {
              domain,
              types: DIPLOMA_TYPES,
              primaryType: "Diploma",
              signature,
            }
          : undefined,
      },
    };
    downloadJson(`univerify-diploma-${selectedItem.docHash}.json`, envelope);
    log.push(`diploma exported: index=${selectedItem.index}, docHash=${selectedItem.docHash}, eip712=${envelope.proof.eip712 ? "yes" : "no"}`);
  }

  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify - Issuer</h1>
      <p className="uv-subtitle">Build Merkle batches, publish roots, and export diploma proofs.</p>

      <div className="uv-card" style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void connect()} disabled={isBusy} className="uv-btn uv-btn-primary">
          Connect MetaMask
        </button>
        <div>
          <div><b>Account:</b> {account || "-"}</div>
          <div><b>University:</b> {accountUniversityName ?? (accountUniversityId ? `ID ${accountUniversityId.toString()}` : "Not registered")}</div>
          <div><b>Network:</b> {chainState === "ok" ? "OK" : chainState === "wrong" ? "Wrong network" : "-"}</div>
          <div><b>Registry:</b> <code>{REGISTRY}</code></div>
        </div>
      </div>

      <div className="uv-card">
        <h2 className="uv-card-title">Step 1: Build Batch</h2>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8, marginTop: 10 }}>Batch ID</label>
        <input
          value={batchIdInput}
          onChange={(e) => {
            setBatchIdInput(e.target.value.trim());
            setComputedBatch(null);
            setSelectedItemIndex(0);
            setSignature(null);
            resetMessages();
          }}
          style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
        />

        <label style={{ display: "block", fontWeight: 600, marginBottom: 8, marginTop: 10 }}>Batch payloads JSON (array)</label>
        <textarea
          value={batchPayloadsText}
          onChange={(e) => {
            setBatchPayloadsText(e.target.value);
            setComputedBatch(null);
            setSelectedItemIndex(0);
            setSignature(null);
            resetMessages();
          }}
          rows={10}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />

        <div className="uv-actions">
          <button onClick={computeBatch} disabled={isBusy || !hasWallet} className="uv-btn">
            Compute batch root + proofs
          </button>
          <button onClick={() => void issueBatchRootTx()} disabled={isBusy || !hasWallet || !computedBatch} className="uv-btn uv-btn-primary">
            Publish batch root (tx)
          </button>
        </div>
        <p className="uv-hint">Compute the batch locally first, then publish the root on-chain. University is resolved from the connected wallet address — no need to include it in payloads.</p>

        {computedBatch && (
          <div style={{ marginTop: 12 }}>
            <p><b>batchId:</b> {computedBatch.batchIdBigint.toString()}</p>
            <p><b>items:</b> {computedBatch.items.length}</p>
            <p><b>merkleRoot:</b> <code>{computedBatch.merkleRoot}</code></p>
          </div>
        )}
      </div>

      <div className="uv-card">
        <h2 className="uv-card-title">Step 2: Select Diploma From Batch</h2>
        {!computedBatch && <p style={{ color: "orange" }}>Compute batch first.</p>}
        {computedBatch && (
          <div style={{ maxHeight: 220, overflowY: "auto", border: "1px solid #eee", padding: 8 }}>
            {computedBatch.items.map((item) => (
              <button
                key={item.index}
                onClick={() => {
                  setSelectedItemIndex(item.index);
                  setSignature(null);
                  setSelectedChainStatus("-");
                  log.push(`selected item: index=${item.index}, docHash=${item.docHash}, proofNodes=${item.proof.length}`);
                }}
                style={{
                  display: "block",
                  width: "100%",
                  textAlign: "left",
                  marginBottom: 6,
                  border: "1px solid #ddd",
                  borderRadius: 6,
                  padding: 8,
                  backgroundColor: item.index === selectedItemIndex ? "#eef6ff" : "#fff",
                  cursor: "pointer",
                }}
              >
                #{item.index} <code>{item.docHash}</code> (proof nodes: {item.proof.length})
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="uv-card">
        <h2 className="uv-card-title">Step 3: Export Diploma Proof</h2>
        {!selectedItem && <p style={{ color: "orange" }}>Select batch item first.</p>}
        {selectedItem && (
          <>
            <p><b>Selected index:</b> {selectedItem.index}</p>
            <p><b>docHash:</b> <code>{selectedItem.docHash}</code></p>
            <p><b>leaf:</b> <code>{selectedItem.leaf}</code></p>
            <p><b>proof nodes:</b> {selectedItem.proof.length}</p>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Payload JSON (selected item)</label>
            <textarea
              readOnly
              value={JSON.stringify(selectedItem.payload, null, 2)}
              rows={12}
              style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
            />
          </>
        )}

        <div className="uv-actions">
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <input
              type="checkbox"
              checked={attachEip712}
              onChange={(e) => {
                setAttachEip712(e.target.checked);
                if (!e.target.checked) setSignature(null);
              }}
            />
            Attach EIP-712 signature (optional)
          </label>
          <button onClick={() => void signDocHash()} disabled={isBusy || !selectedItem || !hasWallet || !attachEip712} className="uv-btn">
            Sign docHash (optional)
          </button>
          <button onClick={exportSelectedProof} disabled={isBusy || !selectedItem} className="uv-btn">
            Export selected proof JSON
          </button>
          <button onClick={exportDiplomaJson} disabled={isBusy || !selectedItem || (attachEip712 && !signature)} className="uv-btn uv-btn-primary">
            Export diploma.json
          </button>
          <button onClick={() => void refreshSelectedStatusFromChain()} disabled={isBusy || !selectedItem || !computedBatch} className="uv-btn">
            Refresh selected status (chain)
          </button>
        </div>
        <p className="uv-hint">Main action in this step: generate and download `diploma.json`.</p>
        {selectedItem && <p style={{ marginTop: 10 }}><b>Selected status:</b> {selectedChainStatus}</p>}
      </div>

      <div style={{ marginTop: 18 }}>
        {(txHash || signature || txState !== "idle") && (
          <div className="uv-status-banner uv-status-ok">
            {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}
            {signature && <p><b>optional EIP-712 signature:</b> <code>{signature}</code></p>}
            {txState !== "idle" && <p><b>State:</b> {txState}</p>}
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
