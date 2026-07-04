# Governance: threat model and cost

## What changed

`DiplomaRegistry` ownership moved from a single EOA to an m-of-n `RegistryMultisig`
acting as proposer/canceller on an OpenZeppelin `TimelockController` (the registry's
new owner). Executor role is open; anyone may execute a scheduled op after the delay.
The registry contract itself is unchanged.

## Threat model comparison

| Property | Single EOA owner | m-of-n multisig + timelock |
|----------|------------------|-----------------------------|
| Single leaked key rewrites authorization | Yes | No — needs m signatures |
| Silent (instant) authorization change | Yes | No — scheduled + delayed on-chain |
| Change is publicly detectable before it takes effect | No | Yes — `CallScheduled` event + delay window |
| Malicious pending change is revocable | No | Yes — m-of-n `cancel` during delay |
| Recover from a compromised signer | n/a | Yes — self-governed `removeOwner`/`addOwner` |
| Liveness if a signer is unavailable | n/a | Tolerates up to n−m unavailable |

## Cost

Measured with `cd contracts && forge test --match-contract GovernanceGasTest --gas-report`
(see `contracts/test/GovernanceGas.t.sol`). All contract deployments and the one-time
ownership handover happen in `setUp()`, so each test body measures exactly one onboard
operation and Foundry's reported per-test total (which excludes `setUp`) is a clean,
directly-reported number requiring no disaggregation. Both tests pass:

```
[PASS] testGas_directOnboard()   (gas:  84246)
[PASS] testGas_governedOnboard() (gas: 824254)
```

**Headline numbers (directly reported, no inference):**

- **Direct EOA onboard: 84,246 gas.** One `onboardIssuerAndUniversity` call against a
  registry owned by a plain EOA — the pre-governance baseline.

- **Governed onboard: 824,254 gas.** The same onboard driven through the full governed
  path — `multisig.submit` + `multisig.confirm` + `multisig.execute` (which schedules on
  the timelock) + `timelock.execute` (which calls the registry after the delay). This is
  the whole four-call round for one authorization change.

- **Governance overhead per authorization change: 824,254 − 84,246 = 740,008 gas.**

**Where the governed gas goes** (illustrative on-chain breakdown from the `--gas-report`
function rows; each row aggregates the one-time `acceptOwnership` bootstrap in `setUp`
with the measured onboard call, and the onboard is the larger payload, so its cost is the
**max** of each pair):

| Call | Gas (on-chain) | Note |
|------|---------------:|------|
| `RegistryMultisig.submit` | 487,647 | dominates — stores the full schedule calldata on-chain |
| `RegistryMultisig.confirm` | 52,213 | payload-independent (min/max within 12 gas) |
| `RegistryMultisig.execute` | 160,119 | calls `timelock.schedule` |
| `TimelockController.execute` | 99,240 | calls `registry.onboardIssuerAndUniversity` |
| **Sum** | **799,219** | on-chain execution only |

The ~25k gap between this on-chain sum and the 824,254 per-test total is test-harness
overhead for ABI-encoding the wrapped schedule calldata, which the reported per-test
total (the headline governed number) includes.

Authorization changes are rare (issuer onboarding/removal), so this overhead is
amortized across every diploma that issuer later issues; it does not affect the
per-diploma issuance cost measured in the Phase 2 L2 benchmarks.

## Residual limitations

`RegistryMultisig.removeOwner` does not clear a removed owner's confirmations on
still-pending transactions. If that same address is later re-added via `addOwner`,
its old confirmation on a pending tx counts again. This is the standard ConsenSys
`MultiSigWallet` trade-off — it avoids unbounded iteration over pending transactions
on every removal. Operationally, re-adding a former owner while sensitive
transactions are pending should be avoided.

## Conclusion

The timelock makes authorization rewrites **non-silent, detectable, and revocable**,
and the m-of-n threshold removes the single-key failure mode — directly strengthening
the thesis's claim that UniVerify's marginal value over PKI is a public, append-only,
tamper-evident authorization log resistant to silent retroactive rewrite.
