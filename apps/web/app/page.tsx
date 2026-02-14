export default function Page() {
  return (
    <main style={{ maxWidth: 900, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>UniVerify</h1>
      <p style={{ marginTop: 10 }}>
        Registry działa teraz wyłącznie w trybie batch Merkle. Użyj dedykowanych widoków:
      </p>
      <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
        <a href="/issuer"><code>/issuer</code></a>
        <a href="/verifier"><code>/verifier</code></a>
        <a href="/revoke"><code>/revoke</code></a>
        <a href="/admin"><code>/admin</code></a>
      </div>
    </main>
  );
}
