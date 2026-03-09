# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

```bash
# Web app
cd apps/web && npm run dev       # Start Next.js dev server
cd apps/web && npm run lint      # Run ESLint

# Build everything (order matters: core → cli → web)
npm run build

# Build individual packages
npm -w @univerify/verifier-core run build
npm -w @univerify/verifier-cli run build
npm -w web run build
```

### Smart Contracts (Foundry)

```bash
cd contracts
forge build                      # Compile contracts
forge test                       # Run Solidity tests
forge test --match-test testName # Run a single test
forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --private-key $OWNER_PK --broadcast
```

Or via root:
```bash
npm run contracts:deploy         # Deploy to chain configured in .env
```

### Environment Sync

```bash
npm run sync:env:sepolia         # Sync env to Sepolia (chainId 11155111)
npm run sync:env:mainnet         # Sync env to mainnet (chainId 1)
```

`.env` requires: `REGISTRY_ADDRESS`, `RPC_URL`, `CHAIN_ID`, `OWNER_PK`

## Architecture

### Monorepo Structure

```
apps/web/           # Next.js 16 + React 19 + Tailwind 4 frontend
packages/verifier-core/   # Shared: hashing, ABI, types
packages/verifier-cli/    # CLI scripts: issue.ts, verify.ts
contracts/          # Solidity (Foundry), DiplomaRegistry.sol
payloads/           # Sample diploma JSON envelopes
scripts/            # sync-env.mjs for env variable management
```

### Core Data Model

Diplomas are batched into Merkle trees and registered on-chain:
- **issuer** (Ethereum address) — university-authorized wallet
- **batchId** (uint64) — batch sequence number per issuer
- **merkleRoot** (bytes32) — root of the Merkle tree for the batch

Each diploma envelope has two parts:
1. `payload` — the diploma data (universityId, student info, etc.)
2. `proof` — either `MERKLE_BATCH` (merkle path) or `EIP712` (signature)

### Diploma Status

`StatusCode`: `0` = Unknown, `1` = Valid, `2` = Revoked

### Smart Contract (`DiplomaRegistry.sol`)

Three tiers of functions:
- **Owner-only**: manage universities and issuers
- **Issuer-only**: `issueBatch()`, revoke diplomas
- **Public view**: `statusWithProof()`, `statusWithProofTrusted()`

The contract maintains university metadata hashes, issuer→university mappings, Merkle roots per issuer batch, and a revocation set.

### Web App Routes (`apps/web/app/`)

| Route | Role | Purpose |
|-------|------|---------|
| `/issuer` | Issuer | Build Merkle batches, issue roots, export diploma proofs |
| `/verifier` | Public | Verify diploma envelopes, check on-chain status |
| `/revoke` | Issuer | Revoke individual diplomas via Merkle proof |
| `/admin` | Owner | Manage issuers and universities on-chain |
| `/api/catalog` | API | GET/PUT catalog snapshot management |

### Web App Library (`apps/web/lib/univerify/`)

| Module | Responsibility |
|--------|---------------|
| `registry.ts` | Read-only contract calls (status, batch, issuer info) |
| `registryWrite.ts` | Issue batch roots and revoke (with gas estimation) |
| `registryAdminWrite.ts` | Admin: add/remove issuers and universities |
| `merkle.ts` | Merkle tree construction and proof generation |
| `hash.ts` | JSON canonicalization + Keccak256 hashing |
| `eip712.ts` | EIP712 signature recovery |
| `types.ts` | Shared TypeScript types for envelopes and domain state |
| `env.ts` | Environment variable validation |
| `registryErrors.ts` | Decode contract revert errors |

### `@univerify/verifier-core`

Consumed by both the web app and CLI. Exports:
- `hashPayload()` — canonicalize + Keccak256
- `DiplomaRegistryAbi` — contract ABI
- `StatusCode` — verification result type

Must be **built before** the web app or CLI (`dist/` is the entry point).
