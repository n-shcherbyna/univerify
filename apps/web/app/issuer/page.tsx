"use client";

import { useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  type Hex,
  type Address,
  isAddress,
} from "viem";
import { sepolia } from "viem/chains";
import {
  DiplomaRegistryAbi,
  type StatusCode,
  hashPayload,
} from "@univerify/verifier-core";

declare global {
  interface Window {
    ethereum?: any;
  }
}

function statusLabel(code: StatusCode) {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

const SEPOLIA_CHAIN_ID_DEC = 11155111;
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

function requireDefined(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function requireAddress(value: string | undefined, name: string): Address {
  const v = requireDefined(value, name);
  if (!isAddress(v)) throw new Error(`Invalid address in env var ${name}: ${v}`);
  return v as Address;
}

export default function IssuerPage() {
  const RPC_URL = useMemo(
    () => requireDefined(process.env.NEXT_PUBLIC_RPC_URL, "NEXT_PUBLIC_RPC_URL"),
    []
  );

  const REGISTRY = useMemo(
    () =>
      requireAddress(
        process.env.NEXT_PUBLIC_REGISTRY_ADDRESS,
        "NEXT_PUBLIC_REGISTRY_ADDRESS"
      ),
    []
  );

  const TARGET_CHAIN_ID = Number(
    process.env.NEXT_PUBLIC_CHAIN_ID ?? String(SEPOLIA_CHAIN_ID_DEC)
  );

  const publicClient = useMemo(
    () => createPublicClient({ chain: sepolia, transport: http(RPC_URL) }),
    [RPC_URL]
  );

  const [account, setAccount] = useState<Address | "">("");
  const [chainOk, setChainOk] = useState(false);

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
  const [status, setStatus] = useState<string>("");
  const [record, setRecord] = useState<{
    issuer: Address;
    issuedAt: string;
    revoked: boolean;
  } | null>(null);

  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [error, setError] = useState<string>("");

  function clearUi() {
    setError("");
    setTxHash(null);
    setStatus("");
    setRecord(null);
  }

  function getEthereum(): any | null {
    if (typeof window === "undefined") return null;
    return window.ethereum ?? null;
  }

  async function ensureSepolia(eth: any) {
    const currentChainIdHex = (await eth.request({
      method: "eth_chainId",
    })) as string;
    const currentChainId = Number.parseInt(currentChainIdHex, 16);

    if (currentChainId === TARGET_CHAIN_ID) {
      setChainOk(true);
      return;
    }

    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${TARGET_CHAIN_ID.toString(16)}` }],
      });
      setChainOk(true);
      return;
    } catch (e: any) {
      if (e?.code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: SEPOLIA_CHAIN_ID_HEX,
              chainName: "Sepolia",
              nativeCurrency: { name: "SepoliaETH", symbol: "ETH", decimals: 18 },
              rpcUrls: [RPC_URL],
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            },
          ],
        });

        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: SEPOLIA_CHAIN_ID_HEX }],
        });

        setChainOk(true);
        return;
      }

      setChainOk(false);
      throw new Error(
        `Wrong network in MetaMask. Switch to Sepolia (chainId ${SEPOLIA_CHAIN_ID_DEC}) and try again.`
      );
    }
  }

  async function connect() {
    clearUi();

    const eth = getEthereum();
    if (!eth) {
      setError("MetaMask not found. Install/enable MetaMask and refresh the page.");
      return;
    }

    try {
      const [addr] = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];

      if (!isAddress(addr)) {
        setError(`Invalid address returned by wallet: ${addr}`);
        return;
      }

      setAccount(addr as Address);
      await ensureSepolia(eth);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  function computeHash() {
    clearUi();

    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      setError("Invalid JSON");
      return;
    }

    const h = hashPayload(payload);
    setDocHash(h);
  }

  async function refreshOnChain(h: Hex) {
    const code = (await publicClient.readContract({
      address: REGISTRY,
      abi: DiplomaRegistryAbi,
      functionName: "status",
      args: [h],
    })) as StatusCode;

    setStatus(statusLabel(code));

    const [issuer, issuedAt, revoked] = (await publicClient.readContract({
      address: REGISTRY,
      abi: DiplomaRegistryAbi,
      functionName: "get",
      args: [h],
    })) as readonly [Address, bigint, boolean];

    setRecord({
      issuer,
      issuedAt:
        issuer === "0x0000000000000000000000000000000000000000"
          ? "-"
          : new Date(Number(issuedAt) * 1000).toISOString(),
      revoked,
    });
  }

  async function writeTx(fn: "issue" | "revoke") {
    clearUi();

    if (!docHash) {
      setError("Compute docHash first");
      return;
    }
    if (!account) {
      setError("Connect MetaMask first");
      return;
    }

    const eth = getEthereum();
    if (!eth) {
      setError("MetaMask not found. Install/enable MetaMask and refresh the page.");
      return;
    }

    try {
      await ensureSepolia(eth);

      const code = (await publicClient.readContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: "status",
        args: [docHash],
      })) as StatusCode;

      if (fn === "issue") {
        if (code !== 0) {
          setError(
            code === 1
              ? "Already issued (Valid)."
              : "Already issued and revoked. Re-issuing the same docHash is not allowed. Create a new payload/docHash."
          );
          await refreshOnChain(docHash);
          return;
        }
      } else {
        if (code === 0) {
          setError("Cannot revoke: diploma not issued (Unknown).");
          await refreshOnChain(docHash);
          return;
        }
        if (code === 2) {
          setError("Already revoked.");
          await refreshOnChain(docHash);
          return;
        }
      }

      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(eth),
        account,
      });

      const gas = await publicClient.estimateContractGas({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: fn,
        args: [docHash],
        account,
      });

      const tx = await walletClient.writeContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: fn,
        args: [docHash],
        gas: (gas * 120n) / 100n,
      });

      setTxHash(tx);
      await refreshOnChain(docHash);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? String(e));
    }
  }

  async function check() {
    setError("");
    setTxHash(null);

    if (!docHash) {
      setError("Compute docHash first");
      return;
    }

    try {
      await refreshOnChain(docHash);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Issuer</h1>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={connect} style={{ padding: "10px 14px", fontWeight: 600 }}>
          Connect MetaMask
        </button>
        <div>
          <div>
            <b>Account:</b> {account || "-"}
          </div>
          <div>
            <b>Network:</b> {chainOk ? "OK (Sepolia)" : "-"}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>
          Payload JSON
        </label>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={computeHash} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Compute docHash
          </button>
          <button onClick={check} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Check status
          </button>
          <button onClick={() => writeTx("issue")} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Issue (tx)
          </button>
          <button onClick={() => writeTx("revoke")} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Revoke (tx)
          </button>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        {docHash && (
          <p>
            <b>docHash:</b> <code>{docHash}</code>
          </p>
        )}

        {status && (
          <p>
            <b>Status:</b> {status}
          </p>
        )}

        {record && (
          <div>
            <p>
              <b>Record:</b>
            </p>
            <ul>
              <li>
                <b>issuer:</b> <code>{record.issuer}</code>
              </li>
              <li>
                <b>issuedAt:</b> {record.issuedAt}
              </li>
              <li>
                <b>revoked:</b> {String(record.revoked)}
              </li>
            </ul>
          </div>
        )}

        {txHash && (
          <p>
            <b>tx:</b> <code>{txHash}</code>
          </p>
        )}

        {error && (
          <p style={{ color: "red" }}>
            <b>Error:</b> {error}
          </p>
        )}
      </div>
    </main>
  );
}
