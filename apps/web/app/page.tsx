export default function Page() {
  return (
    <main className="uv-page">
      <h1 className="uv-title">UniVerify</h1>
      <p className="uv-subtitle">The registry operates in Merkle batch mode. Choose a workspace below.</p>

      <div className="uv-grid" style={{ marginTop: 16 }}>
        <a className="uv-card" href="/issuer">
          <h2 className="uv-card-title">Issuer</h2>
          <p className="uv-hint">Tworzenie batchy, issue root, eksport proof/diploma JSON.</p>
        </a>
        <a className="uv-card" href="/verifier">
          <h2 className="uv-card-title">Verifier</h2>
          <p className="uv-hint">Diploma verification with clear pass/fail reasons.</p>
        </a>
        <a className="uv-card" href="/revoke">
          <h2 className="uv-card-title">Revoke</h2>
          <p className="uv-hint">Revoke a record from a batch using Merkle proof.</p>
        </a>
        <a className="uv-card" href="/admin">
          <h2 className="uv-card-title">Admin</h2>
          <p className="uv-hint">Manage issuers and universities with on-chain actions.</p>
        </a>
      </div>
    </main>
  );
}
