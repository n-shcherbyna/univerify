# UniVerify

On-chain diploma verification system built on Ethereum.

## Architecture

Diplomas are batched into Merkle trees and registered on-chain as a single root hash. This reduces per-diploma issuance cost by up to 98.9% compared to per-record storage.

```
┌─────────────┐     ┌────────────────┐     ┌──────────────────┐
│  Issuer UI  │────▸│  DiplomaRegistry│────▸│  Ethereum L1     │
│  (Next.js)  │     │  (Solidity)     │     │  Merkle roots    │
└─────────────┘     └────────────────┘     └──────────────────┘
       │                    ▲
       ▼                    │
┌─────────────┐     ┌────────────────┐
│ Verifier UI │────▸│  SDK / CLI     │
└─────────────┘     └────────────────┘
```

## Repository Structure

```
contracts/           Solidity smart contracts (Foundry)
  src/               Contract variants (Base, Optimized, OZ, per-record)
  test/              Gas benchmarks and unit tests
  script/            Deployment scripts
apps/web/            Next.js frontend (issuer, verifier, admin panels)
packages/
  verifier-core/     Shared library: hashing, Merkle utilities, ABI, schema
  sdk/               Client SDK wrapping contract reads + verification
  verifier-cli/      CLI tools for issuance and verification
docs/                SITEE paper (LaTeX source)
payloads/            Sample diploma JSON envelopes
scripts/             Environment sync utilities
```

## Smart Contracts

| Contract | Description |
|----------|-------------|
| `DiplomaRegistry.sol` | Merkle-batch registry (baseline Solidity) |
| `DiplomaRegistryG.sol` | Assembly-optimized Merkle verification |
| `DiplomaRegistryOZ.sol` | OpenZeppelin MerkleProof integration |
| `DiplomaRegistryF2.sol` | Per-record storage (packed slots) |

## Prerequisites

- [Node.js](https://nodejs.org/) ≥ 18
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (forge, cast, anvil)

## Quick Start

```bash
# Install dependencies
npm install

# Build packages (order matters)
npm run build

# Run TypeScript tests
npm test

# Run Solidity tests
cd contracts && forge test

# Run gas benchmarks
cd contracts && forge test --gas-report
```

## Development

```bash
# Start the web app
cd apps/web && npm run dev

# Build individual packages
npm -w @univerify/verifier-core run build
npm -w @univerify/sdk run build
npm -w @univerify/verifier-cli run build
npm -w web run build
```

## Deployment

```bash
# Configure .env with: REGISTRY_ADDRESS, RPC_URL, CHAIN_ID, OWNER_PK
cp .env.example .env

# Deploy to Sepolia testnet
npm run deploy:sepolia

# Deploy to mainnet (requires confirmation)
npm run deploy:mainnet
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `REGISTRY_ADDRESS` | Deployed contract address |
| `RPC_URL` | Ethereum JSON-RPC endpoint |
| `CHAIN_ID` | Target network chain ID |
| `OWNER_PK` | Contract owner private key |

## Gas Benchmarks

Verification cost comparison at proof depth 8 (256 diplomas per batch):

| Variant | Verification Gas |
|---------|-----------------|
| Per-record (F2) | 2,587 |
| Baseline Merkle | 7,498 |
| OpenZeppelin | 7,267 |
| Optimized (G) | 5,762 |

See the [paper](docs/sitee-paper.tex) for full benchmark tables and analysis.

## License

[MIT](LICENSE)
