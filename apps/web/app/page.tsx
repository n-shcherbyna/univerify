"use client";

import { useMemo, useState } from "react";
import { createPublicClient, http } from "viem";
import { DiplomaRegistryAbi, StatusCode, hashPayload } from "@univerify/verifier-core";

function statusLabel(code: StatusCode) {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

export default function Page() {
  const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL!;
  const REGISTRY = process.env.NEXT_PUBLIC_REGISTRY_ADDRESS! as `0x${string}`;

  const client = useMemo(() => createPublicClient({ transport: http(RPC_URL) }), [RPC_URL]);

  const [jsonText, setJsonText] = useState<string>('{"example":true}');
  const [docHash, setDocHash] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");

  async function onVerify() {
    setError("");
    setStatus("");
    setDocHash("");

    let payload: unknown;
    try {
      payload = JSON.parse(jsonText);
    } catch {
      setError("Invalid JSON");
      return;
    }

    const h = hashPayload(payload);
    setDocHash(h);

    try {
      const code = (await client.readContract({
        address: REGISTRY,
        abi: DiplomaRegistryAbi,
        functionName: "status",
        args: [h],
      })) as StatusCode;

      setStatus(statusLabel(code));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify — Verify</h1>

      <div style={{ marginTop: 16 }}>
        <label style={{ display: "block", fontWeight: 600, marginBottom: 8 }}>Payload JSON</label>
        <textarea
          value={jsonText}
          onChange={(e) => setJsonText(e.target.value)}
          rows={12}
          style={{ width: "100%", fontFamily: "monospace", padding: 12 }}
        />
        <button
          onClick={onVerify}
          style={{ marginTop: 12, padding: "10px 14px", fontWeight: 600 }}
        >
          Verify
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        {docHash && (
          <p><b>docHash:</b> <code>{docHash}</code></p>
        )}
        {status && (
          <p><b>Status:</b> {status}</p>
        )}
        {error && (
          <p style={{ color: "red" }}><b>Error:</b> {error}</p>
        )}
      </div>
    </main>
  );
}
