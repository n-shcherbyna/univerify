# Governance Hardening — Design Spec

**Date:** 2026-07-04
**Status:** Approved (design), pending implementation plan
**Author:** Nazar Shcherbyna
**Context:** UniVerify master's thesis, "last valuable feature." Closes the centralization
gap flagged as future work on the Phase 3 "dalsze prace" slide.

## Problem

The Phase 3 value analysis concludes that UniVerify's *only* marginal advantage over
signed PKI is a **public, append-only, tamper-evident log of who may issue diplomas,
resistant to silent retroactive rewrite.** But that authorization log is currently
controlled by a **single EOA** (`DiplomaRegistry.owner`, gated by `onlyOwner`, one
`OWNER_PK`). A single leaked key can silently rewrite issuer/university authorization —
directly undermining the property that justifies the whole approach.

The owner-gated authorization surface is four functions:
`setUniversity`, `onboardIssuerAndUniversity`, `removeIssuer`, `transferOwnership`.

## Goal

Replace the single-EOA owner with **m-of-n multisig + timelock** governance so that:

1. **No single key can act** (threshold control) — addresses key compromise.
2. **Every authorization change is scheduled on-chain, publicly, and cannot execute
   until a delay passes** — makes rewrites *non-silent, detectable, and revocable*
   during the delay window, matching the thesis's core claim.

Non-goals: on-chain governance token / voting, changing `DiplomaRegistry` behavior.
Signer rotation IS in scope (see below) — a multisig that cannot remove a compromised or
lost signer would contradict the key-compromise resilience this feature argues for.

## Key constraint: registry stays byte-for-byte unchanged

`DiplomaRegistry.sol` is NOT modified. Governance is installed purely via the registry's
existing two-step ownership transfer (`transferOwnership` → `acceptOwnership`). This
preserves all Phase 2 L2 benchmarks — no re-measurement needed.

## Architecture

Three roles, two new deployable units, registry unchanged:

```
 m-of-n owners (EOAs)
        │  submit / confirm / execute
        ▼
 RegistryMultisig  ──PROPOSER_ROLE + CANCELLER_ROLE──►  TimelockController (OZ 5.6.1)
                                                              │  owner of
                                                              ▼
                                                        DiplomaRegistry (unchanged)
        anyone ──EXECUTOR_ROLE (open)── executes after delay ─┘
```

### 1. `RegistryMultisig.sol` (new, minimal m-of-n)

Purpose-built, single-responsibility, heavily tested. ~120 lines.

State:
- `address[] owners` + `mapping(address => bool) isOwner` — initialized from constructor,
  mutable via self-governed rotation (below). Removal uses swap-and-pop keeping `isOwner` in sync.
- `uint256 threshold` — initialized from constructor. Constructor and every rotation enforce the
  invariant `0 < threshold <= owners.length`, owners non-zero and unique.
- Transaction queue: `struct Tx { address target; uint256 value; bytes data; bool executed; }`,
  stored by incrementing `txId`.
- `mapping(uint256 => mapping(address => bool)) confirmed` + `mapping(uint256 => uint256) confirmations`.

Functions (all owner-gated except views):
- `submit(address target, uint256 value, bytes data) returns (uint256 txId)` — creates a tx
  and auto-confirms by `msg.sender`.
- `confirm(uint256 txId)` — records a confirmation; reverts if already confirmed or executed.
- `revoke(uint256 txId)` — withdraws caller's confirmation (before execution).
- `execute(uint256 txId)` — requires `confirmations[txId] >= threshold` and not executed;
  performs the low-level call `target.call{value}(data)`; reverts on call failure; marks executed.
- Views: `getOwners()`, `threshold()`, `txCount()`, `getTx(txId)`, `confirmationsOf(txId)`,
  `isConfirmed(txId, owner)`.

Self-governed signer rotation (all `onlySelf` — callable only via an executed multisig tx,
i.e. they require m-of-n; no new trust assumption, standard Gnosis-Safe pattern):
- `addOwner(address newOwner)` — reverts on zero/duplicate.
- `removeOwner(address owner)` — reverts if unknown or if it would drop `owners.length` below
  `threshold`; swap-and-pop.
- `changeThreshold(uint256 newThreshold)` — enforces the invariant above.
The `onlySelf` modifier requires `msg.sender == address(this)`, so a rotation is itself an
m-of-n tx: `submit(address(this), 0, addOwner.encode(...))` → confirm → execute. Rotation does
NOT route through the timelock (it does not touch the registry; the m-of-n gate is sufficient).

Events: `Submitted(txId, target, value, data, proposer)`, `Confirmed(txId, owner)`,
`Revoked(txId, owner)`, `Executed(txId)`, `OwnerAdded(owner)`, `OwnerRemoved(owner)`,
`ThresholdChanged(threshold)`.

Guards: `onlyOwner` modifier; `onlySelf` for rotation; reject execution below threshold; reject
double-execute; reject actions on unknown/executed txs. Reentrancy: `executed` set before the
external call (checks-effects-interactions).

### 2. `TimelockController` (OZ 5.6.1, no new code)

Deployed with:
- `minDelay` — **48 h (172800 s) production default**; a deploy parameter (tests/local use
  short values, e.g. 1–2 s or a few seconds).
- `proposers = [address(multisig)]` — OZ grants both `PROPOSER_ROLE` and `CANCELLER_ROLE`.
- `executors = [address(0)]` — anyone may execute a ready operation.
- `admin = address(0)` — no external admin; the timelock self-administers, so role changes
  themselves require a timelock op. No backdoor.

### 3. Ownership handover (bootstrap)

Deployed by an EOA that is initially the registry owner. Sequence:
1. Deploy `RegistryMultisig(owners, threshold)`.
2. Deploy `TimelockController(minDelay, [multisig], [address(0)], address(0))`.
3. EOA calls `registry.transferOwnership(timelock)` (sets `pendingOwner`).
4. `registry.acceptOwnership()` must be called *by the timelock* (`msg.sender == pendingOwner`).
   So it is a governed op: m-of-n → `multisig.submit(timelock, 0, schedule(registry, 0,
   acceptOwnership(), 0, salt, minDelay))` → confirm → `execute` → wait `minDelay` →
   `timelock.execute(registry, 0, acceptOwnership(), 0, salt)`.

Driven with the same steady-state `gov` subcommands using `--op acceptOwnership`
(`propose` → `confirm` → `exec-multisig` → wait `minDelay` → `execute`); the
`DeployGovernance` script prints this exact sequence after setting `pendingOwner`.
For local/test convenience a short `minDelay` completes the handover quickly.

## Authorization-change lifecycle (steady state)

For any owner op `F(args)` on the registry (e.g. `onboardIssuerAndUniversity`):

1. Encode `opCalldata = registry.F.encode(args)`.
2. **Schedule (m-of-n):** an owner calls
   `multisig.submit(timelock, 0, timelock.schedule.encode(registry, 0, opCalldata, predecessor=0, salt, minDelay))`.
   Other owners `confirm`; once `>= threshold`, any owner calls `multisig.execute(txId)`,
   which fires `timelock.schedule(...)` → emits `CallScheduled` (public, tamper-evident).
3. **Wait** `minDelay`.
4. **Execute (permissionless):** anyone calls `timelock.execute(registry, 0, opCalldata, 0, salt)`
   → the registry op runs → emits the registry's own event (`IssuerAdded`, etc.).
5. **Cancel (m-of-n, during delay):** owners `submit`/`confirm`/`execute`
   `timelock.cancel(operationId)` to revoke a scheduled op before it takes effect.

`operationId = timelock.hashOperation(registry, 0, opCalldata, 0, salt)`. `salt` is chosen
per proposal (e.g. keccak of a nonce/description) so identical ops can be re-proposed.

## CLI (`packages/verifier-cli`)

New `gov` command group (script style consistent with existing `issue.ts` / `verify.ts`).
The one-time ownership handover uses the same subcommands with `--op acceptOwnership`
(no dedicated `bootstrap` command); steady-state ops:
- `gov propose --op <name> --args <...>` — build registry calldata, wrap in `schedule`,
  call `multisig.submit`. Prints `txId`, `operationId`, and computed ready-at.
- `gov confirm --tx <txId>`.
- `gov exec-multisig --tx <txId>` — fires the scheduled `timelock.schedule`.
- `gov execute --op <operationId>` — after delay, calls `timelock.execute`.
- `gov cancel --op <operationId>` — m-of-n cancel flow.
- `gov owner add|remove --address <addr>` and `gov threshold set --value <m>` — self-governed
  rotation (each is an m-of-n `submit`/`confirm`/`execute` targeting the multisig itself).
- `gov status` — list pending multisig txs (with confirmations) and pending timelock ops
  (with state + ready-at); also prints current owners + threshold.

Reads env for `MULTISIG_ADDRESS`, `TIMELOCK_ADDRESS`, `REGISTRY_ADDRESS`, `RPC_URL`,
signer key(s).

## SDK (`packages/sdk`)

Add read-only helpers to `UniverifySdk` (or a `governance` namespace):
- `getMultisigInfo()` → `{ owners, threshold, txCount }`.
- `getMultisigTx(txId)` → `{ target, value, data, executed, confirmations }`.
- `getTimelockDelay()` → `minDelay`.
- `getOperationState(operationId)` → `Unset | Pending | Ready | Done` + `readyAt` timestamp.

Constructor config extended with optional `multisigAddress`, `timelockAddress`.

## Web `/admin` — full wallet flow

`apps/web/app/admin/page.tsx` reworked into three sections, wallet-driven end-to-end via
existing `wallet.ts` and a new `lib/univerify/registryGovernanceWrite.ts` (plus governance
reads in `registry.ts`):

- **(a) Propose change** — the existing authorization forms (set university, onboard issuer,
  remove issuer); on submit they now encode the registry op, wrap in `timelock.schedule`, and
  call `multisig.submit`.
- **(b) Pending multisig txs** — list with target/decoded action, confirmation count vs
  threshold, and `confirm` / `revoke` / `execute` buttons (enabled per state and per whether
  the connected wallet is an owner / has already confirmed).
- **(c) Scheduled timelock ops** — list with decoded action, state, **live countdown** to
  ready-at, and `execute` (anyone) / `cancel` (m-of-n) buttons.

Decoding: reuse `DiplomaRegistryAbi` to decode the inner registry calldata for human-readable
display. Pre-handover (owner still EOA) the page may keep a direct-call mode; post-handover all
writes route through governance.

## Tests (`contracts/test`, Foundry)

Multisig unit:
- constructor validation (threshold bounds, zero/duplicate owners revert);
- submit auto-confirms; confirm/revoke adjust count; non-owner rejected;
- execute reverts below threshold; execute reverts if already executed; double-confirm reverts;
- execute forwards call and reverts on inner-call failure;
- rotation: `addOwner`/`removeOwner`/`changeThreshold` revert when called directly (not `onlySelf`)
  and succeed only via an executed m-of-n tx; `removeOwner` reverts if it would drop below
  threshold; duplicate/zero/unknown-owner reverts; owner set and `isOwner` stay consistent.

Integration (multisig + timelock + registry):
- full schedule → warp `minDelay` → execute path performs the registry op;
- execute-before-delay reverts (`TimelockUnexpectedOperationState`);
- cancel during delay prevents execution;
- post-handover: direct `registry.onboardIssuerAndUniversity` from the old EOA reverts
  (`OnlyOwner`); only timelock-routed calls succeed;
- bootstrap handover test (transfer → governed accept → timelock is owner).

## Thesis deliverable (docs)

A short writeup (matches existing chapter style; Polish for the thesis chapter, English design
doc is this file):
- **Threat-model table:** single EOA vs m-of-n+timelock across properties — single-key
  compromise, silent rewrite, detectability, recoverability (cancel-during-delay).
- **Gas-overhead measurement:** direct owner call vs governed `schedule` + `execute` for a
  representative op (e.g. `onboardIssuerAndUniversity`), reported as an absolute and per-change
  overhead. Reuses the existing benchmarks harness patterns where practical.

This is the research payoff: the weakness named on the "dalsze prace" slide becomes a
demonstrated, measured property.

## Defaults (all deploy parameters)

| Parameter | Default | Notes |
|-----------|---------|-------|
| Multisig owners (n) | 3 | deploy param |
| Threshold (m) | 2 | deploy param, `2-of-3` |
| Signer rotation | self-governed (m-of-n) | `onlySelf` add/remove/changeThreshold |
| Timelock `minDelay` | 48 h (172800 s) | deploy param; tests use short values |
| Executor | `address(0)` (anyone) | after delay only |
| Timelock admin | `address(0)` | no backdoor |

## Build / rules reminders

- Build order stays core → sdk → cli → web.
- `forge test` must pass before any deploy; never deploy to mainnet without explicit
  confirmation and shown chain id/name.
- No changes to `DiplomaRegistry.sol` — verify byte-identical to preserve Phase 2 benchmarks.
