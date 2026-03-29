<p align="center">
  <h1 align="center">UniVerify</h1>
  <p align="center">
    On-chain diploma verification using Merkle-batched roots on Ethereum
  </p>
</p>

<p align="center">
  <a href="https://github.com/n-shcherbyna/univerify/actions/workflows/ci.yml"><img src="https://github.com/n-shcherbyna/univerify/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://github.com/n-shcherbyna/univerify"><img src="https://img.shields.io/badge/solidity-%5E0.8.28-363636.svg" alt="Solidity"></a>
  <a href="https://github.com/n-shcherbyna/univerify"><img src="https://img.shields.io/badge/next.js-16-black.svg" alt="Next.js 16"></a>
</p>

---

> **Gas-Efficient On-Chain Diploma Verification: Merkle Batching vs. Per-Record Storage on Ethereum**
> Nazar Shcherbyna, Bartosz Sawicki — Warsaw University of Technology, SITEE 2026

## Features

- **Merkle-batched issuance** — register hundreds of diplomas under a single on-chain root hash, reducing per-diploma gas cost by up to 98.9%
- **On-chain verification** — anyone can verify a diploma's authenticity using only the smart contract and a Merkle proof
- **Revocation support** — issuers can revoke individual diplomas without affecting the rest of the batch
- **Multi-university registry** — one contract manages multiple universities, each with their own authorized issuers
- **Full-stack tooling** — web app, REST API, TypeScript SDK, and CLI included
- **Gas-optimized variants** — four contract implementations benchmarked for verification cost

## Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────────┐
│  Issuer UI  │────▸│  DiplomaRegistry │────▸│  Ethereum L1     │
│  (Next.js)  │     │  (Solidity)      │     │  Merkle roots    │
└─────────────┘     └──────────────────┘     └──────────────────┘
       │                    ▲
       ▼                    │
┌─────────────┐     ┌──────────────────┐
│ Verifier UI │────▸│  SDK / CLI       │
└─────────────┘     └──────────────────┘
```

**Flow:**
1. Issuer collects diploma payloads and builds a Merkle tree off-chain
2. The Merkle root is registered on-chain via `issueBatchRoot()`
3. Each graduate receives a diploma envelope containing their data + Merkle proof
4. Anyone can verify a diploma by recomputing the root from the proof and checking it on-chain

## Repository Structure

```
contracts/               Solidity smart contracts (Foundry)
  src/                   Contract variants (baseline, optimized, OZ, per-record)
  test/                  Gas benchmarks and unit tests
  script/                Deployment scripts
apps/web/                Next.js 16 frontend (issuer, verifier, admin panels)
packages/
  verifier-core/         Shared library: hashing, Merkle utilities, ABI, schema
  sdk/                   Client SDK wrapping contract reads + verification
  verifier-cli/          CLI tools for issuance and verification
docs/                    SITEE 2026 paper (LaTeX source + PDF)
payloads/                Sample diploma JSON envelopes
scripts/                 Environment sync utilities
```

## Smart Contracts

| Contract | Strategy | Description |
|----------|----------|-------------|
| `DiplomaRegistry.sol` | Merkle batch | Baseline Solidity implementation |
| `DiplomaRegistryG.sol` | Merkle batch | Assembly-optimized Merkle verification |
| `DiplomaRegistryOZ.sol` | Merkle batch | OpenZeppelin `MerkleProof` integration |
| `DiplomaRegistryF2.sol` | Per-record | Packed slot storage (comparison baseline) |

### Gas Benchmarks

Verification cost comparison at proof depth 8 (256 diplomas per batch):

| Variant | Verification Gas | Strategy |
|---------|-----------------|----------|
| Per-record (F2) | 2,587 | Direct storage lookup |
| Optimized (G) | 5,762 | Assembly Merkle proof |
| OpenZeppelin (OZ) | 7,267 | Library Merkle proof |
| Baseline | 7,498 | Solidity Merkle proof |

> Merkle batching reduces **issuance cost by up to 98.9%** compared to per-record storage. See the [paper](docs/sitee-paper.pdf) for full benchmark tables and analysis.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 18
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast, anvil)

## Quick Start

```bash
# Clone the repository
git clone https://github.com/n-shcherbyna/univerify.git
cd univerify

# Install dependencies
npm install

# Build all packages (order matters: core → sdk → cli → web)
npm run build

# Run TypeScript tests
npm test

# Run Solidity tests
cd contracts && forge test
```

## Development

```bash
# Start the web app in development mode
cd apps/web && npm run dev

# Build individual packages
npm -w @univerify/verifier-core run build
npm -w @univerify/sdk run build
npm -w @univerify/verifier-cli run build
npm -w web run build

# Run Solidity gas benchmarks
cd contracts && forge test --gas-report
```

## Deployment

```bash
# 1. Configure environment
cp .env.example .env
# Edit .env with your RPC_URL, OWNER_PK, etc.

# 2. Deploy to Sepolia testnet
npm run deploy:sepolia

# 3. Deploy to mainnet (requires confirmation)
npm run deploy:mainnet
```

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `REGISTRY_ADDRESS` | Deployed DiplomaRegistry address | `0x1D77...5A4f` |
| `RPC_URL` | Ethereum JSON-RPC endpoint | `https://eth-sepolia.g.alchemy.com/v2/KEY` |
| `CHAIN_ID` | Target network chain ID | `11155111` |
| `OWNER_PK` | Contract owner private key | `0x...` |

The web app uses `NEXT_PUBLIC_` prefixed versions of these variables. See `apps/web/.env.local` after running `npm run sync:env:sepolia`.

## SDK Usage

```typescript
import { UniverifySdk } from "@univerify/sdk";

const sdk = new UniverifySdk({
  rpcUrl: "https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY",
  registryAddress: "0x...",
  chainId: 11155111,
});

// Verify a diploma envelope
const result = await sdk.verify(envelope);
console.log(result.status); // 1 = Valid, 2 = Revoked, 0 = Unknown

// Lightweight status check
const status = await sdk.status(docHash, issuer, batchId, proof);
```

## REST API

The web app exposes two API endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/verify` | POST | Full diploma verification with university metadata |
| `/api/status` | GET | Lightweight status check by docHash/issuer/batchId/proof |

Both endpoints support optional API key authentication (via `Bearer` token or `X-API-Key` header) and rate limiting (30 requests per 60 seconds per IP).

## Contributing

Contributions are welcome! Please read the [Contributing Guide](CONTRIBUTING.md) before submitting a pull request.

## Security

If you discover a security vulnerability, please follow the [Security Policy](SECURITY.md) for responsible disclosure. **Do not open a public issue.**

## Paper

The full research paper is available in the [`docs/`](docs/) directory:

- [PDF](docs/sitee-paper.pdf) — compiled paper
- [LaTeX source](docs/sitee-paper.tex) — source code

## License

This project is licensed under the [MIT License](LICENSE).

---

<sub>Built at Warsaw University of Technology</sub>
