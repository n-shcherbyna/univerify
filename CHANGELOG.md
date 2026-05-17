# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-05-17

### Added

- `@univerify/benchmarks` — L2 cost & latency benchmark pipeline (deploy → measure → price → export → aggregate)
- Per-rollup parametric cost models with EIP-4844 blob basefee accounting (`src/cost-models/{sepolia,base,arbitrum,zksync}.ts`)
- Base Ecotone L1-fee formula with snapshotted SystemConfig scalars (`baseFeeScalar=2269`, `blobBaseFeeScalar=1055762`, L1 block 25087416)
- Arbitrum Nitro post-Cancun blob accounting (1.0 Brotli ratio assumption, documented)
- Live blob basefee fetched via `eth_feeHistory` (Pectra-safe; no local `fakeExponential`)
- L2 sequencer prices and ETH/USD snapshot cited and env-overridable
- Phase 2 thesis chapter `docs/univerify-l2-benchmarks.tex` with generated tables under `docs/l2-benchmarks/data/`
- `npm run benchmarks:all` single-command reproduction with `--runs=N` aggregation
- CI drift check regenerating `docs/l2-benchmarks/data/` from committed results

### Changed

- Issuance-batch latency measured with N≥30 samples per size (was N=1); σ now reported
- Revocation burst uses uniformly-random leaf selection (was deterministic first 30)
- Multi-run pipeline (default 3 runs) for cross-run variance characterization

### Security

- `BENCH_PK` no longer appears in process argv during deploy (`execFileSync` with arg array)

## [0.1.0] - 2026-03-29

### Added

- `DiplomaRegistry.sol` — Merkle-batch diploma registry with issuance, verification, and revocation
- `DiplomaRegistryG.sol` — assembly-optimized Merkle verification variant
- `DiplomaRegistryOZ.sol` — OpenZeppelin MerkleProof variant
- `DiplomaRegistryF2.sol` — per-record storage variant for gas comparison
- `@univerify/verifier-core` — shared library (hashing, Merkle utilities, ABI, Zod schema)
- `@univerify/sdk` — client SDK wrapping contract reads and full diploma verification
- `@univerify/verifier-cli` — CLI tools for batch issuance and single-diploma verification
- Next.js 16 web application with issuer, verifier, admin, and revocation panels
- REST API (`/api/verify`, `/api/status`) with rate limiting and optional API key auth
- Sepolia testnet deployment
- Gas benchmark suite comparing all four contract variants
- SITEE 2026 research paper (LaTeX source + PDF)
