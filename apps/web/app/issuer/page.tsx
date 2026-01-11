"use client";

import { useMemo, useState } from "react";
import {
  createPublicClient,
  createWalletClient,
  custom,
  http,
  isAddress,
  recoverTypedDataAddress,
  type Address,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains";
import { DiplomaRegistryAbi, type StatusCode, hashPayload } from "@univerify/verifier-core";

declare global {
  interface Window {
    ethereum?: any;
  }
}

type ChainState = "unknown" | "ok" | "wrong";
type TxState = "idle" | "signing" | "submitting" | "confirming";

type OnChainRecord = {
  issuer: Address;
  issuedAt: string;
  revoked: boolean;
};

/**
 * EIP-712 proof in envelope.
 * Keep it explicit so verifier can reconstruct exactly what was signed.
 */
type Eip712Domain = {
  name: string;
  version: string;
  chainId: number;
  verifyingContract: Address;
};

type DiplomaTypes = {
  Diploma: readonly [{ name: "docHash"; type: "bytes32" }];
};

type DiplomaEnvelope = {
  payload: unknown;
  proof: {
    type: "EIP712";
    domain: Eip712Domain;
    types: DiplomaTypes;
    primaryType: "Diploma";
    signature: Hex;

    // optional informational fields (not needed for cryptographic verification)
    issuer?: Address;
    issuedAt?: string;
  };
};

const SEPOLIA_CHAIN_ID_DEC = 11155111;
const SEPOLIA_CHAIN_ID_HEX = "0xaa36a7";

function statusLabel(code: StatusCode) {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

function requireDefined(value: string | undefined, name: string): string {
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function requireAddress(value: string | undefined, name: string): Address {
  const v = requireDefined(value, name);
  if (!isAddress(v)) throw new Error(`Invalid address in env var ${name}: ${v}`);
  return v as Address;
}

function getEthereum(): any | null {
  if (typeof window === "undefined") return null;
  return window.ethereum ?? null;
}

function parsePayload(
  jsonText: string
): { ok: true; payload: unknown } | { ok: false; error: string } {
  try {
    return { ok: true, payload: JSON.parse(jsonText) };
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
}

function downloadJson(filename: string, obj: unknown) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

const DIPLOMA_TYPES: DiplomaTypes = {
  Diploma: [{ name: "docHash", type: "bytes32" }],
} as const;

export default function IssuerPage() {
  const RPC_URL = useMemo(
    () => requireDefined(process.env.NEXT_PUBLIC_RPC_URL, "NEXT_PUBLIC_RPC_URL"),
    []
  );

  const REGISTRY = useMemo(
    () => requireAddress(process.env.NEXT_PUBLIC_REGISTRY_ADDRESS, "NEXT_PUBLIC_REGISTRY_ADDRESS"),
    []
  );

  const TARGET_CHAIN_ID = useMemo(
    () => Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? String(SEPOLIA_CHAIN_ID_DEC)),
    []
  );

  const publicClient = useMemo(
    () => createPublicClient({ chain: sepolia, transport: http(RPC_URL) }),
    [RPC_URL]
  );

  const [account, setAccount] = useState<Address | "">("");
  const [chainState, setChainState] = useState<ChainState>("unknown");

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
  const [signature, setSignature] = useState<Hex | null>(null);

  const [status, setStatus] = useState<string>("");
  const [record, setRecord] = useState<OnChainRecord | null>(null);

  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [txState, setTxState] = useState<TxState>("idle");
  const [error, setError] = useState<string>("");

  const isBusy = txState !== "idle";

  const [logs, setLogs] = useState<string[]>([]);
  const [verifyOK, setVerifyOk] = useState<boolean | null>(null);

  function pushLog(msg: string) {
    setLogs((prev) => [...prev, msg]);
    // eslint-disable-next-line no-console
    console.log(msg);
  }

  function resetMessages() {
    setError("");
    setTxHash(null);
    setVerifyOk(null);
    setLogs([]);
  }

  function resetOnChainView() {
    setStatus("");
    setRecord(null);
  }

  function resetComputed() {
    setDocHash(null);
    setSignature(null);
  }

  function buildDomain(): Eip712Domain {
    return {
      name: "UniVerify",
      version: "1",
      chainId: TARGET_CHAIN_ID,
      verifyingContract: REGISTRY,
    };
  }

  async function ensureTargetChain(eth: any) {
    const currentChainIdHex = (await eth.request({ method: "eth_chainId" })) as string;
    const currentChainId = Number.parseInt(currentChainIdHex, 16);

    if (currentChainId === TARGET_CHAIN_ID) {
      setChainState("ok");
      return;
    }

    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: `0x${TARGET_CHAIN_ID.toString(16)}` }],
      });
      setChainState("ok");
      return;
    } catch (e: any) {
      if (e?.code === 4902 && TARGET_CHAIN_ID === SEPOLIA_CHAIN_ID_DEC) {
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

        setChainState("ok");
        return;
      }

      setChainState("wrong");
      throw new Error(`Wrong network in MetaMask. Switch to chainId ${TARGET_CHAIN_ID} and try again.`);
    }
  }

  async function connect() {
    resetMessages();
    resetOnChainView();

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh the page.");

    try {
      const [addr] = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      if (!isAddress(addr)) return setError(`Invalid address returned by wallet: ${addr}`);
      setAccount(addr as Address);
      await ensureTargetChain(eth);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  function computeDocHash() {
    resetMessages();
    resetOnChainView();
    setSignature(null);

    const parsed = parsePayload(jsonText);
    if (!parsed.ok) return setError(parsed.error);

    setDocHash(hashPayload(parsed.payload));
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

  async function checkOnChainStatus() {
    resetMessages();
    if (!docHash) return setError("Compute docHash first");

    try {
      await refreshOnChain(docHash);
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  async function verifySignatureAndChain() {
    resetMessages();

    if (!docHash) return setError("Compute docHash first");
    if (!signature) return setError("Sign docHash first");

    try {
      const domain = buildDomain();

      pushLog("=== UniVerify verify (EIP-712 + chain) ===");
      pushLog(`docHash: ${docHash}`);
      pushLog(`domain.name: ${domain.name}`);
      pushLog(`domain.version: ${domain.version}`);
      pushLog(`domain.chainId: ${domain.chainId}`);
      pushLog(`domain.verifyingContract: ${domain.verifyingContract}`);
      pushLog(`signature: ${signature}`);

      const recovered = await recoverTypedDataAddress({
        domain,
        types: DIPLOMA_TYPES,
        primaryType: "Diploma",
        message: { docHash },
        signature,
      });
      pushLog(`recovered signer: ${recovered}`);

      const code = (await publicClient.readContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: "status",
        args: [docHash],
      })) as StatusCode;

      const label = statusLabel(code);
      pushLog(`on-chain status: ${code} (${label})`);

      const [issuer, issuedAt, revoked] = (await publicClient.readContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: "get",
        args: [docHash],
      })) as readonly [Address, bigint, boolean];

      const issuedAtIso =
        issuer === "0x0000000000000000000000000000000000000000"
          ? "-"
          : new Date(Number(issuedAt) * 1000).toISOString();

      pushLog(`on-chain issuer: ${issuer}`);
      pushLog(`on-chain issuedAt: ${issuedAtIso}`);
      pushLog(`on-chain revoked: ${String(revoked)}`);

      setStatus(label);
      setRecord({ issuer, issuedAt: issuedAtIso, revoked });

      const statusOk = code === 1;
      const issuerOk = recovered.toLowerCase() === issuer.toLowerCase();

      pushLog(`check: status == Valid -> ${statusOk ? "OK" : "FAIL"}`);
      pushLog(`check: recovered == onChainIssuer -> ${issuerOk ? "OK" : "FAIL"}`);

      const ok = statusOk && issuerOk;
      setVerifyOk(ok);

      pushLog(`RESULT: ${ok ? "VERIFIED ✅" : "NOT VERIFIED ❌"}`);
      if (!ok) {
        if (!statusOk) pushLog(`reason: expected status Valid (1), got ${code} (${label})`);
        if (!issuerOk) pushLog("reason: signature does not match on-chain issuer");
      }
    } catch (e: any) {
      setVerifyOk(false);
      setError(e?.message ?? String(e));
      pushLog(`ERROR: ${e?.message ?? String(e)}`);
    }
  }

  async function signDocHash() {
    resetMessages();
    if (!docHash) return setError("Compute docHash first");
    if (!account) return setError("Connect MetaMask first");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh the page.");

    setTxState("signing");
    try {
      await ensureTargetChain(eth);

      const walletClient = createWalletClient({
        chain: sepolia,
        transport: custom(eth),
        account,
      });

      const domain = buildDomain();

      const sig = await walletClient.signTypedData({
        account,
        domain,
        types: DIPLOMA_TYPES,
        primaryType: "Diploma",
        message: { docHash },
      });

      // sanity-check
      const recovered = await recoverTypedDataAddress({
        domain,
        types: DIPLOMA_TYPES,
        primaryType: "Diploma",
        message: { docHash },
        signature: sig,
      });

      if (recovered.toLowerCase() !== account.toLowerCase()) {
        throw new Error("EIP-712 signature sanity-check failed (recovered address mismatch).");
      }

      setSignature(sig);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setTxState("idle");
    }
  }

  function exportDiplomaJson() {
    resetMessages();

    const parsed = parsePayload(jsonText);
    if (!parsed.ok) return setError(parsed.error);
    if (!docHash) return setError("Compute docHash first");
    if (!signature) return setError("Sign docHash first");

    const domain = buildDomain();

    const envelope: DiplomaEnvelope = {
      payload: parsed.payload,
      proof: {
        type: "EIP712",
        domain,
        types: DIPLOMA_TYPES,
        primaryType: "Diploma",
        signature,
        issuer: account || undefined,
        issuedAt: new Date().toISOString(),
      },
    };

    downloadJson(`univerify-diploma-${docHash}.json`, envelope);
  }

  async function writeTx(fn: "issue" | "revoke") {
    resetMessages();

    if (!docHash) return setError("Compute docHash first");
    if (!account) return setError("Connect MetaMask first");

    const eth = getEthereum();
    if (!eth) return setError("MetaMask not found. Install/enable MetaMask and refresh the page.");

    setTxState("submitting");
    try {
      await ensureTargetChain(eth);

      const code = (await publicClient.readContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: "status",
        args: [docHash],
      })) as StatusCode;

      if (fn === "issue") {
        if (code !== 0) {
          setError(code === 1 ? "Already issued (Valid)." : "Already issued and revoked. Re-issuing is not allowed.");
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

      const walletClient = createWalletClient({ chain: sepolia, transport: custom(eth), account });

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

      setTxState("confirming");
      await publicClient.waitForTransactionReceipt({ hash: tx });

      await refreshOnChain(docHash);
    } catch (e: any) {
      setError(e?.shortMessage ?? e?.message ?? String(e));
    } finally {
      setTxState("idle");
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Issuer</h1>

      <div style={{ marginTop: 12, display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={connect} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
          Connect MetaMask
        </button>
        <div>
          <div><b>Account:</b> {account || "-"}</div>
          <div><b>Network:</b> {chainState === "ok" ? "OK" : chainState === "wrong" ? "Wrong network" : "-"}</div>
          <div><b>Registry:</b> <code>{REGISTRY}</code></div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Payload JSON</label>
        <textarea
          value={jsonText}
          onChange={(e) => {
            setJsonText(e.target.value);
            resetComputed();
            resetOnChainView();
            resetMessages();
          }}
          rows={12}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />

        <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button onClick={computeDocHash} disabled={isBusy} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Compute docHash
          </button>

          <button onClick={signDocHash} disabled={isBusy || !docHash || !account} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Sign docHash (EIP-712)
          </button>

          <button onClick={exportDiplomaJson} disabled={isBusy || !docHash || !signature} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Export diploma.json
          </button>

          <button onClick={checkOnChainStatus} disabled={isBusy || !docHash} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Check status (chain)
          </button>

          <button onClick={verifySignatureAndChain} disabled={isBusy || !docHash || !signature} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Verify (EIP-712 + chain)
          </button>

          <button onClick={() => writeTx("issue")} disabled={isBusy || !docHash || !account} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Issue (tx)
          </button>

          <button onClick={() => writeTx("revoke")} disabled={isBusy || !docHash || !account} style={{ padding: "10px 14px", fontWeight: 600 }}>
            Revoke (tx)
          </button>
        </div>

        {txState !== "idle" && (
          <p style={{ marginTop: 10 }}><b>State:</b> {txState}</p>
        )}
      </div>

      <div style={{ marginTop: 18 }}>
        {docHash && <p><b>docHash:</b> <code>{docHash}</code></p>}
        {signature && <p><b>signature (EIP-712):</b> <code>{signature}</code></p>}
        {status && <p><b>Status:</b> {status}</p>}

        {record && (
          <div>
            <p><b>Record:</b></p>
            <ul>
              <li><b>issuer:</b> <code>{record.issuer}</code></li>
              <li><b>issuedAt:</b> {record.issuedAt}</li>
              <li><b>revoked:</b> {String(record.revoked)}</li>
            </ul>
          </div>
        )}

        {txHash && <p><b>tx:</b> <code>{txHash}</code></p>}

        {error && <p style={{ color: "red" }}><b>Error:</b> {error}</p>}

        {verifyOK !== null && (
          <p style={{ color: verifyOK ? "green" : "red" }}>
            <b>Verification result:</b> {verifyOK ? "VERIFIED ✅" : "NOT VERIFIED ❌"}
          </p>
        )}

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
