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
(see `contracts/test/GovernanceGas.t.sol`). Both tests pass. Raw output:

```
[PASS] testGas_directOnboard() (gas: 1255013)
[PASS] testGas_governedOnboard() (gas: 5418462)

RegistryMultisig — Function Name | Min    | Avg    | Median | Max    | # Calls
submit                           | 267668 | 377621 | 377621 | 487575 | 2
execute                          | 125844 | 142981 | 142981 | 160119 | 2
confirm                          | 52201  | 52207  | 52207  | 52213  | 2

TimelockController — Function Name | Min   | Avg   | Median | Max   | # Calls
execute                            | 44861 | 72014 | 72014  | 99168 | 2

DiplomaRegistry — Function Name    | Min   | Avg   | Median | Max   | # Calls
onboardIssuerAndUniversity         | 78693 | 78693 | 78693  | 78693 | 1
```

**What each headline number measures:**

- **Direct EOA `onboardIssuerAndUniversity`: 78,693 gas.** This is the per-function
  cost of the call itself (the `DiplomaRegistry.onboardIssuerAndUniversity` row
  above), i.e. the owner-only baseline with no governance wrapper.

- **Governed path (schedule + execute, excluding one-time deploy/handover):
  799,075 gas.** `testGas_governedOnboard` runs two governed rounds back-to-back
  through the same multisig+timelock pair: a one-time `acceptOwnership` bootstrap
  (handing the registry to the timelock) followed by the actual onboarding change.
  Each of `submit`, `RegistryMultisig.execute`, and `TimelockController.execute` is
  therefore reported as an aggregate over 2 calls (one per round), while `confirm`'s
  cost is independent of payload size (both calls land within 12 gas of each other:
  52,201 vs 52,213). The two rounds are distinguishable because the onboarding
  calldata (issuer address, university id, name, country, website, accreditation id)
  is much larger than the empty-argument `acceptOwnership` call, and the downstream
  write is heavier (78,693 gas alone vs a two-field ownership flip) — both push
  submit/execute costs to the **max** of each pair. Cross-checking against the known
  standalone cost of `onboardIssuerAndUniversity` (78,693 gas) plus the timelock's own
  execute overhead lands almost exactly on the reported `TimelockController.execute`
  max (99,168), confirming the max values are the onboarding round, not the bootstrap.
  So: `submit` (487,575, max) + `confirm` (52,213) + `RegistryMultisig.execute`
  (160,119, max) + `TimelockController.execute` (99,168, max) = **799,075 gas** for
  one governed onboarding change, excluding the one-time contract deployments and the
  one-time ownership-handover bootstrap.

- **Overhead per authorization change: 799,075 − 78,693 = 720,382 gas.**

For reference, the raw per-test totals (which *do* include one-time deployment and
bootstrap costs) are 1,255,013 gas for `testGas_directOnboard` (registry deployment +
one call) and 5,418,462 gas for `testGas_governedOnboard` (three contract
deployments + ownership handover + both governed rounds).

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
