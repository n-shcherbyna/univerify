export default function HomePage() {
  return (
    <main className="uv-page">
      {/* Hero */}
      <div style={{ paddingTop: 32, paddingBottom: 16 }}>
        <h1 className="uv-title" style={{ fontSize: 44, letterSpacing: "-0.03em" }}>
          <span className="uv-title-gradient">UniVerify</span>
        </h1>
        <p style={{ marginTop: 14, fontSize: 16, maxWidth: 580, lineHeight: 1.65, color: "var(--muted)" }}>
          A tamper-proof diploma registry on Ethereum. Universities publish cryptographic batch roots on-chain.
          Anyone can verify a diploma in seconds — no trust in a central server required.
        </p>
      </div>

      {/* How it works */}
      <div className="uv-card" style={{ marginTop: 28 }}>
        <h2 className="uv-card-title" style={{ marginBottom: 20 }}>How it works</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 20 }}>
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
            <div key={step} style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
              <div className="uv-step-num">{step}</div>
              <div>
                <div style={{ fontWeight: 700, marginBottom: 4, fontSize: 15 }}>{title}</div>
                <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>{desc}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Trust model */}
      <div className="uv-card">
        <h2 className="uv-card-title" style={{ marginBottom: 16 }}>Trust model</h2>
        <div className="uv-grid">
          {[
            { title: "Blockchain as source of truth", desc: "Batch roots are stored on Ethereum. No central database can be tampered with." },
            { title: "Issuer identity on-chain", desc: "Only registered issuer addresses can publish roots. The registry owner controls who qualifies." },
            { title: "Merkle proofs", desc: "A diploma file cryptographically proves it belongs to a batch — without revealing other graduates." },
            { title: "Revocation", desc: "Individual diplomas can be revoked on-chain by the issuer without invalidating the whole batch." },
          ].map(({ title, desc }) => (
            <div key={title} style={{
              padding: 16, borderRadius: 12,
              border: "1px solid var(--surface-border)",
              background: "var(--accent-glow)",
              transition: "border-color 0.2s ease",
            }}>
              <div style={{ fontWeight: 700, marginBottom: 6, fontSize: 14 }}>{title}</div>
              <div style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.55 }}>{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Role cards */}
      <h2 className="uv-section-heading" style={{ marginTop: 36 }}>Choose your workspace</h2>
      <div className="uv-grid">
        {[
          { href: "/verifier", title: "Verifier", desc: "Upload a diploma.json and get an instant on-chain verification result with full transparency on why it passed or failed." },
          { href: "/issuer", title: "Issuer", desc: "Build a Merkle batch from diploma payloads, publish the root on-chain, and export individual diploma files for graduates." },
          { href: "/revoke", title: "Revoke", desc: "Revoke a specific diploma from a batch using its Merkle proof. The revocation is recorded permanently on-chain." },
          { href: "/admin", title: "Admin", desc: "Register universities and issuers on-chain. Requires the registry owner wallet." },
        ].map(({ href, title, desc }) => (
          <a key={href} className="uv-card uv-card-link" href={href}>
            <h3 className="uv-card-title">{title}</h3>
            <p className="uv-hint" style={{ marginTop: 8 }}>{desc}</p>
            <div className="uv-workspace-link">
              Open {title.toLowerCase()} <span className="uv-card-arrow">&rarr;</span>
            </div>
          </a>
        ))}
      </div>

      {/* Footer */}
      <div className="uv-footer">
        Deployed on Ethereum Sepolia testnet &middot; Open source &middot; Verification requires no account or login
      </div>
    </main>
  );
}
