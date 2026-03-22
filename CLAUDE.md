# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

### Development

```bash
# Web app
cd apps/web && npm run dev       # Start Next.js dev server
cd apps/web && npm run lint      # Run ESLint

# Build everything (order matters: core → sdk → cli → web)
npm run build

# Build individual packages
npm -w @univerify/verifier-core run build
npm -w @univerify/sdk run build
npm -w @univerify/verifier-cli run build
npm -w web run build

# Run all tests (vitest)
npm test
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
npm run deploy:sepolia           # Build + deploy + sync env for Sepolia
npm run deploy:mainnet           # Build + deploy + sync env for mainnet
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
apps/web/                  # Next.js 16 + React 19 + Tailwind 4 frontend
packages/verifier-core/    # Shared: hashing, Merkle utilities, ABI, schema, types
packages/sdk/              # Client SDK: UniverifySdk class wrapping contract reads + verification
packages/verifier-cli/     # CLI scripts: issue.ts, verify.ts
contracts/                 # Solidity (Foundry), DiplomaRegistry.sol
payloads/                  # Sample diploma JSON envelopes
scripts/                   # sync-env.mjs for env variable management
docs/                      # Documentation
```

### Core Data Model

Diplomas are batched into Merkle trees and registered on-chain:
- **issuer** (Ethereum address) — university-authorized wallet
- **batchId** (uint64) — batch sequence number per issuer
- **merkleRoot** (bytes32) — root of the Merkle tree for the batch

Each diploma envelope has two parts:
1. `payload` — the diploma data (universityId, student info, etc.)
2. `proof` — `MERKLE_BATCH` type with merkle path

### Diploma Status

`StatusCode`: `0` = Unknown, `1` = Valid, `2` = Revoked

### Smart Contract (`DiplomaRegistry.sol`)

Three tiers of functions:
- **Owner-only**: manage universities and issuers, two-step ownership transfer (`transferOwnership` / `acceptOwnership`)
- **Issuer-only**: `issueBatch()`, `revokeFromBatch()`
- **Public view**: `statusWithProof()`, `getBatch()`, `isIssuer()`, `issuerUniversityId()`

University status enum: Unknown (0), Active (1), Suspended (2), Revoked (3).

The contract maintains university metadata (name, country, website, accreditationId), issuer→university mappings, Merkle roots per issuer batch, and a revocation set.

### Web App Routes (`apps/web/app/`)

| Route | Role | Purpose |
|-------|------|---------|
| `/issuer` | Issuer | Build Merkle batches, issue roots, export diploma proofs |
| `/verifier` | Public | Verify diploma envelopes, check on-chain status |
| `/revoke` | Issuer | Revoke individual diplomas via Merkle proof |
| `/admin` | Owner | Manage issuers and universities on-chain |
| `/api/verify` | API | POST — full diploma verification with university metadata |
| `/api/status` | API | GET — lightweight status check by docHash/issuer/batchId/proof |
| `/api/catalog` | API | GET/PUT catalog snapshot management |

### REST API (`/api/verify`, `/api/status`)

Both API routes are protected by a guard (`lib/api/guard.ts`) that runs:
1. **API key auth** (`lib/api/apiKey.ts`) — optional, enforced only when `UNIVERIFY_API_KEYS` env var is set. Accepts `Bearer` token or `X-API-Key` header.
2. **Rate limiting** (`lib/api/rateLimit.ts`) — 30 requests per 60s per client IP, in-memory sliding window.

### Web App Library (`apps/web/lib/`)

| Module | Responsibility |
|--------|---------------|
| `univerify/registry.ts` | Read-only contract calls (status, batch, issuer info) |
| `univerify/registryWrite.ts` | Issue batch roots and revoke (with gas estimation) |
| `univerify/registryAdminWrite.ts` | Admin: add/remove issuers and universities |
| `univerify/merkle.ts` | Re-exports Merkle utilities from verifier-core |
| `univerify/hash.ts` | JSON canonicalization + Keccak256 hashing |
| `univerify/wallet.ts` | Ethereum wallet integration |
| `univerify/types.ts` | Shared TypeScript types for envelopes and domain state |
| `univerify/schema.ts` | Zod schema for DiplomaPayload |
| `univerify/env.ts` | Environment variable validation |
| `univerify/json.ts` | JSON parsing and validation |
| `univerify/logs.ts` | State logging utility |
| `univerify/file.ts` | File utilities |
| `univerify/registryErrors.ts` | Decode contract revert errors |
| `api/guard.ts` | API guard: runs API key + rate limit checks |
| `api/apiKey.ts` | Optional API key authentication |
| `api/rateLimit.ts` | In-memory sliding window rate limiter |

### `@univerify/verifier-core`

Shared package consumed by the web app, CLI, and SDK. Exports:
- `hashPayload()` — canonicalize + Keccak256
- `computeMerkleLeaf()` — domain-separated leaf hashing
- `buildMerkleFromLeaves()` — build tree, return root + proofs
- `computeRootFromProof()` — recompute root from leaf + proof
- `DiplomaRegistryAbi` — contract ABI
- `DiplomaPayloadSchema` — Zod schema for diploma payload validation
- `DiplomaPayload` — TypeScript type (inferred from schema)
- `StatusCode` — verification result type (0 | 1 | 2)
- `formatZodError()` — Zod error formatter

Must be **built before** the SDK, web app, or CLI (`dist/` is the entry point).

### `@univerify/sdk`

Client library wrapping contract reads and full diploma verification. Main export: `UniverifySdk` class.

Constructor config: `rpcUrl`, `registryAddress`, `chainId`, `deployBlock?`

Public methods:
- `verify(envelope)` — full verification with university metadata
- `status(docHash, issuer, batchId, proof)` — lightweight status check
- `getBatch(issuer, batchId)` — batch merkle root info
- `getIssuer(issuer)` — issuer details and university association
- `getUniversity(universityId)` — university metadata
- `getOwner()` / `getPendingOwner()` — ownership info

Also re-exports key types and utilities from verifier-core.

## Rules

- **Never deploy to mainnet without explicit user confirmation.** Always show the chain ID and network name before broadcasting any transaction.
- **Always run `forge test` before deploying.** Do not deploy if any test fails.
- **Always rebuild `verifier-core` before building `sdk`, `web`, or `cli`.** Stale builds cause subtle bugs. Build order: core → sdk → cli → web.
