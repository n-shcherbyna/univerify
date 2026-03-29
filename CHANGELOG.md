# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
