"use client";

import { useMemo, useState } from "react";
import { isAddress, type Address, type Hex } from "viem";

import { readPublicEnv } from "@/lib/univerify/env";
import { makePublicClient, readIsIssuer, readOwner } from "@/lib/univerify/registry";
import { getEthereum, ensureChain, makeWalletClient } from "@/lib/univerify/wallet";
import { makeStateLogger } from "@/lib/univerify/logs";
import type { ChainState, TxState } from "@/lib/univerify/types";
import { writeIssuerAdminTx } from "@/lib/univerify/registryAdminWrite";

export default function AdminPage() {
  const { rpcUrl: RPC_URL, registry: REGISTRY, chainId: TARGET_CHAIN_ID } = useMemo(() => readPublicEnv(), []);
  const publicClient = useMemo(() => makePublicClient(RPC_URL), [RPC_URL]);

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");

  const [owner, setOwner] = useState<Address | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [issuerInput, setIssuerInput] = useState<string>("");
  const [issuerStatus, setIssuerStatus] = useState<boolean | null>(null);

  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [error, setError] = useState<string>("");

  const [logs, setLogs] = useState<string[]>([]);
  const log = useMemo(() => makeStateLogger(setLogs), [setLogs]);

  const isBusy = txState !== "idle";

  function resetMessages() {
    setError("");
    setTxHash(null);
    log.clear();
  }

  async function refreshOwnerAndAdmin(addr?: Address) {
    const o = await readOwner({ publicClient, registry: REGISTRY });
    setOwner(o);

    const acc = addr ?? (account || null);
    if (acc) setIsAdmin(acc.toLowerCase() === o.toLowerCase());
    else setIsAdmin(false);

    log.push(`owner: ${o}`);
    if (acc) log.push(`account: ${acc} -> isAdmin=${acc.toLowerCase() === o.toLowerCase()}`);
  }

  async function connect() {
    resetMessages();

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) return setError(`Invalid address returned by wallet: ${addr}`);
      const a = addr as Address;
      setAccount(a);

      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");

      await refreshOwnerAndAdmin(a);
    } catch (e: any) {
      setChainState("wrong");
      setError(e?.message ?? String(e));
    }
  }

  async function checkIssuer() {
    resetMessages();
    if (!isAddress(issuerInput)) return setError("Enter a valid issuer address.");
    try {
      const ok = await readIsIssuer({ publicClient, registry: REGISTRY, issuer: issuerInput as Address });
      setIssuerStatus(ok);
      log.push(`isIssuer(${issuerInput}) = ${ok}`);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function write(fn: "addIssuer" | "removeIssuer") {
    resetMessages();
    if (!account) return setError("Connect MetaMask first.");
    if (!isAddress(issuerInput)) return setError("Enter a valid issuer address.");
    if (!owner) await refreshOwnerAndAdmin();

    if (!isAdmin) return setError("Only contract owner can manage issuers.");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found.");

    try {
      await ensureChain({ eth, targetChainId: TARGET_CHAIN_ID });
      setChainState("ok");

      const walletClient = makeWalletClient({ eth, account });

      await writeIssuerAdminTx({
        fn,
        issuer: issuerInput as Address,
        registry: REGISTRY,
        account,
        publicClient,
        walletClient,
        setTxState,
        onTxHash: setTxHash,
        onAfter: async () => {
          await refreshOwnerAndAdmin();
          const ok = await readIsIssuer({ publicClient, registry: REGISTRY, issuer: issuerInput as Address });
          setIssuerStatus(ok);
        },
      });
    } catch (e: any) {
      setTxState("idle");
      setError(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Admin (Issuers)</h1>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void connect()} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
          Connect MetaMask
        </button>
        <div>
          <div><b>Account:</b> {account || "-"}</div>
          <div><b>Network:</b> {chainState === "ok" ? "OK" : chainState === "wrong" ? "Wrong network" : "-"}</div>
          <div><b>Registry:</b> <code>{REGISTRY}</code></div>
          <div><b>Owner:</b> <code>{owner ?? "-"}</code></div>
          <div><b>Is admin:</b> <span style={{ color: isAdmin ? "green" : "orange" }}>{isAdmin ? "YES" : "NO"}</span></div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Issuer address</label>
        <input
          value={issuerInput}
          onChange={(e) => {
            setIssuerInput(e.target.value.trim());
            setIssuerStatus(null);
            resetMessages();
          }}
          placeholder="0x..."
          style={{ width: "100%", fontFamily: "monospace", padding: 10 }}
        />

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => void checkIssuer()} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Check isIssuer
          </button>

          <button onClick={() => void write("addIssuer")} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Add issuer (tx)
          </button>

          <button onClick={() => void write("removeIssuer")} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Remove issuer (tx)
          </button>
        </div>

        {issuerStatus !== null && (
          <p style={{ marginTop: 10 }}>
            <b>isIssuer:</b>{" "}
            <span style={{ color: issuerStatus ? "green" : "orange" }}>
              {issuerStatus ? "YES" : "NO"}
            </span>
          </p>
        )}

        {txState !== "idle" && (
          <p style={{ marginTop: 10 }}>
            <b>State:</b> {txState}
          </p>
        )}

        {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}
        {error && <p style={{ color: "red" }}><b>Error:</b> {error}</p>}

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
