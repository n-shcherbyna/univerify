export default function HomePage() {
  return (
    <main className="uv-page">
      {/* Hero */}
      <div style={{ paddingTop: 24, paddingBottom: 8 }}>
        <h1 className="uv-title" style={{ fontSize: 38 }}>UniVerify</h1>
        <p style={{ marginTop: 12, fontSize: 16, maxWidth: 620, lineHeight: 1.6, color: "var(--muted)" }}>
          A tamper-proof diploma registry on Ethereum. Universities publish cryptographic batch roots on-chain.
          Anyone can verify a diploma in seconds — no trust in a central server required.
        </p>
      </div>

      {/* How it works */}
      <div className="uv-card" style={{ marginTop: 28 }}>
        <h2 className="uv-card-title" style={{ marginBottom: 16 }}>How it works</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 16 }}>
          {[
            {
              step: "1",
              title: "Issue",
              desc: "A university issuer builds a Merkle tree from diploma payloads and publishes the root on-chain in one transaction.",
            },
            {
              step: "2",
              title: "Distribute",
              desc: "Each graduate receives a diploma.json file containing their payload and a Merkle inclusion proof.",
            },
            {
              step: "3",
              title: "Verify",
              desc: "Anyone with the diploma.json can reconstruct the Merkle root and compare it against the on-chain record — instantly.",
            },
          ].map(({ step, title, desc }) => (
            <div key={step} style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
              <div style={{
                minWidth: 32, height: 32, borderRadius: "50%",
                background: "#111827", color: "#fff",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontWeight: 700, fontSize: 14, flexShrink: 0,
              }}>
                {step}
              </div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trust model */}
      <div className="uv-card">
        <h2 className="uv-card-title" style={{ marginBottom: 12 }}>Trust model</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
          {[
            { icon: "⛓", title: "Blockchain as source of truth", desc: "Batch roots are stored on Ethereum. No central database can be tampered with." },
            { icon: "🔑", title: "Issuer identity on-chain", desc: "Only registered issuer addresses can publish roots. The registry owner controls who qualifies." },
            { icon: "🌿", title: "Merkle proofs", desc: "A diploma file cryptographically proves it belongs to a batch — without revealing other graduates." },
            { icon: "🚫", title: "Revocation", desc: "Individual diplomas can be revoked on-chain by the issuer without invalidating the whole batch." },
          ].map(({ icon, title, desc }) => (
            <div key={title} style={{ padding: 14, borderRadius: 10, border: "1px solid var(--surface-border)" }}>
              <div style={{ fontSize: 22, marginBottom: 6 }}>{icon}</div>
              <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 14 }}>{title}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Role cards */}
      <h2 style={{ marginTop: 32, marginBottom: 4, fontWeight: 700, fontSize: 18 }}>Choose your workspace</h2>
      <div className="uv-grid">
        <a className="uv-card" href="/verifier" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🔍</div>
          <h3 className="uv-card-title">Verifier</h3>
          <p className="uv-hint" style={{ marginTop: 6 }}>
            Upload a diploma.json and get an instant on-chain verification result with full transparency on why it passed or failed.
          </p>
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "#6366f1" }}>Open verifier →</div>
        </a>
        <a className="uv-card" href="/issuer" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>🏛</div>
          <h3 className="uv-card-title">Issuer</h3>
          <p className="uv-hint" style={{ marginTop: 6 }}>
            Build a Merkle batch from diploma payloads, publish the root on-chain, and export individual diploma files for graduates.
          </p>
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "#6366f1" }}>Open issuer →</div>
        </a>
        <a className="uv-card" href="/revoke" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>❌</div>
          <h3 className="uv-card-title">Revoke</h3>
          <p className="uv-hint" style={{ marginTop: 6 }}>
            Revoke a specific diploma from a batch using its Merkle proof. The revocation is recorded permanently on-chain.
          </p>
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "#6366f1" }}>Open revoke →</div>
        </a>
        <a className="uv-card" href="/admin" style={{ textDecoration: "none", color: "inherit", display: "block" }}>
          <div style={{ fontSize: 28, marginBottom: 8 }}>⚙️</div>
          <h3 className="uv-card-title">Admin</h3>
          <p className="uv-hint" style={{ marginTop: 6 }}>
            Register universities and issuers on-chain. Requires the registry owner wallet.
          </p>
          <div style={{ marginTop: 12, fontSize: 13, fontWeight: 600, color: "#6366f1" }}>Open admin →</div>
        </a>
      </div>

      {/* Footer note */}
      <p style={{ marginTop: 36, fontSize: 12, color: "var(--muted)", textAlign: "center" }}>
        Deployed on Ethereum Sepolia testnet · Open source ·{" "}
        Verification requires no account or login
      </p>
    </main>
  );
}
