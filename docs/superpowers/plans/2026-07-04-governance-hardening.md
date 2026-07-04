# Governance Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `DiplomaRegistry`'s single-EOA owner with an m-of-n multisig + OpenZeppelin `TimelockController`, so every issuer/university authorization change is threshold-approved, publicly scheduled, delayed, and cancellable — without modifying `DiplomaRegistry.sol`.

**Architecture:** A minimal `RegistryMultisig` (m-of-n, self-governed signer rotation) holds `PROPOSER_ROLE`+`CANCELLER_ROLE` on an OZ `TimelockController`, which becomes the registry's `owner` via the existing two-step ownership transfer. Executor role is open (anyone executes after the delay). Registry stays byte-for-byte identical so Phase 2 benchmarks remain valid.

**Tech Stack:** Solidity 0.8.20 + Foundry, OpenZeppelin 5.6.1 (`TimelockController`), TypeScript, viem 2.x (CLI + SDK + web), Next.js 16 / React 19 (web `/admin`).

## Global Constraints

- Solidity `^0.8.20`; `contracts/foundry.toml` uses `solc_version = "0.8.20"`, `optimizer_runs = 200`.
- OpenZeppelin remapping already present: `@openzeppelin/=lib/openzeppelin-contracts/` (v5.6.1).
- **`contracts/src/DiplomaRegistry.sol` MUST NOT be modified** — verify byte-identical to preserve Phase 2 benchmarks.
- Build order is always: `verifier-core` → `sdk` → `cli` → `web`.
- `forge test` must pass before any deploy. Never deploy to mainnet without explicit confirmation and shown chainId + network name.
- CLI/SDK use viem; ABIs live in `packages/verifier-core/src/abi.ts` and are consumed everywhere via `@univerify/verifier-core`.
- Defaults (all deploy params): 3 owners, threshold 2 (`2-of-3`), `minDelay` 172800 s (48 h) in prod, short values in tests; executor `address(0)` (anyone); timelock admin `address(0)`.

---

## File Structure

**Contracts**
- Create `contracts/src/RegistryMultisig.sol` — minimal m-of-n multisig + self-governed rotation.
- Create `contracts/test/RegistryMultisig.t.sol` — multisig unit tests.
- Create `contracts/test/Governance.t.sol` — multisig + `TimelockController` + registry integration tests.
- Create `contracts/script/DeployGovernance.s.sol` — deploy multisig + timelock, hand over registry ownership.

**verifier-core (ABIs)**
- Modify `packages/verifier-core/src/abi.ts` — add `RegistryMultisigAbi`, `TimelockControllerAbi`.
- Modify `packages/verifier-core/src/index.ts` — export the two ABIs.

**SDK**
- Modify `packages/sdk/src/client.ts` — governance read helpers on `UniverifySdk`.
- Modify `packages/sdk/src/index.ts` — export new governance types.
- Modify `packages/sdk/src/client.test.ts` — tests for the read helpers (encode-only / mocked).

**CLI**
- Create `packages/verifier-cli/src/gov.ts` — `gov` command group.

**Web**
- Create `apps/web/lib/univerify/governance.ts` — governance reads + calldata builders (shared).
- Create `apps/web/lib/univerify/registryGovernanceWrite.ts` — wallet writes (submit/confirm/revoke/execute/schedule/cancel).
- Modify `apps/web/app/admin/page.tsx` — three-section governance UI.

**Docs (thesis payoff)**
- Create `contracts/test/GovernanceGas.t.sol` — gas-overhead measurement (direct owner call vs governed schedule+execute).
- Create `docs/governance-threat-model.md` — threat-model table + measured gas overhead.

---

## Task 1: `RegistryMultisig` core (submit / confirm / revoke / execute)

**Files:**
- Create: `contracts/src/RegistryMultisig.sol`
- Test: `contracts/test/RegistryMultisig.t.sol`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `constructor(address[] memory _owners, uint256 _threshold)`
  - `submit(address target, uint256 value, bytes calldata data) returns (uint256 txId)` (onlyOwner, auto-confirms)
  - `confirm(uint256 txId)` / `revoke(uint256 txId)` (onlyOwner)
  - `execute(uint256 txId)` (onlyOwner; requires `confirmations[txId] >= threshold`)
  - views: `getOwners()`, `ownerCount()`, `txCount()`, `getTx(uint256) returns (address,uint256,bytes,bool)`, public mappings `isOwner`, `threshold`, `confirmations`, `confirmed`
  - errors: `NotOwner, OnlySelf, ZeroOwner, DuplicateOwner, UnknownOwner, InvalidThreshold, UnknownTx, AlreadyConfirmed, NotConfirmed, AlreadyExecuted, NotEnoughConfirmations, CallFailed`
  - events: `Submitted, Confirmed, Revoked, Executed, OwnerAdded, OwnerRemoved, ThresholdChanged`

- [ ] **Step 1: Write the failing test**

Create `contracts/test/RegistryMultisig.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {RegistryMultisig} from "../src/RegistryMultisig.sol";

/// A trivial call target used to prove `execute` forwards calls.
contract Counter {
    uint256 public n;
    function bump(uint256 by) external { n += by; }
    function boom() external pure { revert("boom"); }
}

contract RegistryMultisigTest is Test {
    RegistryMultisig ms;
    Counter counter;

    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    address outsider = address(0xBAD);

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = a; owners[1] = b; owners[2] = c;
        ms = new RegistryMultisig(owners, 2);
        counter = new Counter();
    }

    function _submitBump(address who, uint256 by) internal returns (uint256 id) {
        vm.prank(who);
        id = ms.submit(address(counter), 0, abi.encodeCall(Counter.bump, (by)));
    }

    function testSubmitAutoConfirms() public {
        uint256 id = _submitBump(a, 5);
        assertEq(ms.confirmations(id), 1);
        assertTrue(ms.confirmed(id, a));
    }

    function testExecuteRequiresThreshold() public {
        uint256 id = _submitBump(a, 5);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.NotEnoughConfirmations.selector);
        ms.execute(id);

        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
        assertEq(counter.n(), 5);
    }

    function testNonOwnerRejected() public {
        vm.prank(outsider);
        vm.expectRevert(RegistryMultisig.NotOwner.selector);
        ms.submit(address(counter), 0, "");
    }

    function testDoubleConfirmReverts() public {
        uint256 id = _submitBump(a, 1);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.AlreadyConfirmed.selector);
        ms.confirm(id);
    }

    function testRevokeLowersCount() public {
        uint256 id = _submitBump(a, 1);
        vm.prank(b);
        ms.confirm(id);
        assertEq(ms.confirmations(id), 2);
        vm.prank(b);
        ms.revoke(id);
        assertEq(ms.confirmations(id), 1);
    }

    function testDoubleExecuteReverts() public {
        uint256 id = _submitBump(a, 1);
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.AlreadyExecuted.selector);
        ms.execute(id);
    }

    function testExecuteRevertsOnInnerFailure() public {
        vm.prank(a);
        uint256 id = ms.submit(address(counter), 0, abi.encodeCall(Counter.boom, ()));
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.CallFailed.selector);
        ms.execute(id);
    }

    function testConstructorRejectsBadThreshold() public {
        address[] memory owners = new address[](2);
        owners[0] = a; owners[1] = b;
        vm.expectRevert(RegistryMultisig.InvalidThreshold.selector);
        new RegistryMultisig(owners, 3);
    }

    function testConstructorRejectsDuplicateOwner() public {
        address[] memory owners = new address[](2);
        owners[0] = a; owners[1] = a;
        vm.expectRevert(RegistryMultisig.DuplicateOwner.selector);
        new RegistryMultisig(owners, 1);
    }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd contracts && forge test --match-contract RegistryMultisigTest`
Expected: FAIL — `RegistryMultisig` source file not found / does not compile.

- [ ] **Step 3: Write minimal implementation**

Create `contracts/src/RegistryMultisig.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RegistryMultisig — minimal m-of-n multisig
/// @notice Threshold-gated transaction queue. Owner set and threshold are
///         mutable only via self-governed rotation (see addOwner/removeOwner/
///         changeThreshold, all onlySelf, i.e. require an executed m-of-n tx).
contract RegistryMultisig {
    error NotOwner();
    error OnlySelf();
    error ZeroOwner();
    error DuplicateOwner();
    error UnknownOwner();
    error InvalidThreshold();
    error UnknownTx();
    error AlreadyConfirmed();
    error NotConfirmed();
    error AlreadyExecuted();
    error NotEnoughConfirmations();
    error CallFailed();

    struct Transaction {
        address target;
        uint256 value;
        bytes data;
        bool executed;
    }

    address[] private owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;

    Transaction[] private transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;
    mapping(uint256 => uint256) public confirmations;

    event Submitted(uint256 indexed txId, address indexed proposer, address target, uint256 value, bytes data);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Revoked(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 threshold);

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    constructor(address[] memory _owners, uint256 _threshold) {
        for (uint256 i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            if (o == address(0)) revert ZeroOwner();
            if (isOwner[o]) revert DuplicateOwner();
            isOwner[o] = true;
            owners.push(o);
        }
        _setThreshold(_threshold);
    }

    // ── Transactions ─────────────────────────────────────────────────────────

    function submit(address target, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256 txId)
    {
        txId = transactions.length;
        transactions.push(Transaction({target: target, value: value, data: data, executed: false}));
        emit Submitted(txId, msg.sender, target, value, data);
        _confirm(txId);
    }

    function confirm(uint256 txId) external onlyOwner {
        _confirm(txId);
    }

    function _confirm(uint256 txId) private {
        if (txId >= transactions.length) revert UnknownTx();
        if (transactions[txId].executed) revert AlreadyExecuted();
        if (confirmed[txId][msg.sender]) revert AlreadyConfirmed();
        confirmed[txId][msg.sender] = true;
        confirmations[txId] += 1;
        emit Confirmed(txId, msg.sender);
    }

    function revoke(uint256 txId) external onlyOwner {
        if (txId >= transactions.length) revert UnknownTx();
        if (transactions[txId].executed) revert AlreadyExecuted();
        if (!confirmed[txId][msg.sender]) revert NotConfirmed();
        confirmed[txId][msg.sender] = false;
        confirmations[txId] -= 1;
        emit Revoked(txId, msg.sender);
    }

    function execute(uint256 txId) external onlyOwner {
        if (txId >= transactions.length) revert UnknownTx();
        Transaction storage t = transactions[txId];
        if (t.executed) revert AlreadyExecuted();
        if (confirmations[txId] < threshold) revert NotEnoughConfirmations();
        t.executed = true; // effects before interaction (reentrancy-safe)
        (bool ok, ) = t.target.call{value: t.value}(t.data);
        if (!ok) revert CallFailed();
        emit Executed(txId);
    }

    // ── Self-governed rotation (onlySelf → require m-of-n) ────────────────────

    function addOwner(address newOwner) external onlySelf {
        if (newOwner == address(0)) revert ZeroOwner();
        if (isOwner[newOwner]) revert DuplicateOwner();
        isOwner[newOwner] = true;
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    function removeOwner(address owner) external onlySelf {
        if (!isOwner[owner]) revert UnknownOwner();
        if (owners.length - 1 < threshold) revert InvalidThreshold();
        isOwner[owner] = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
    }

    function changeThreshold(uint256 newThreshold) external onlySelf {
        _setThreshold(newThreshold);
    }

    function _setThreshold(uint256 newThreshold) private {
        if (newThreshold == 0 || newThreshold > owners.length) revert InvalidThreshold();
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function ownerCount() external view returns (uint256) {
        return owners.length;
    }

    function txCount() external view returns (uint256) {
        return transactions.length;
    }

    function getTx(uint256 txId)
        external
        view
        returns (address target, uint256 value, bytes memory data, bool executed)
    {
        if (txId >= transactions.length) revert UnknownTx();
        Transaction storage t = transactions[txId];
        return (t.target, t.value, t.data, t.executed);
    }

    receive() external payable {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd contracts && forge test --match-contract RegistryMultisigTest -vv`
Expected: PASS (all `testSubmitAutoConfirms`, `testExecuteRequiresThreshold`, … green).

- [ ] **Step 5: Commit**

```bash
git add contracts/src/RegistryMultisig.sol contracts/test/RegistryMultisig.t.sol
git commit -m "feat(contracts): add RegistryMultisig m-of-n core"
```

---

## Task 2: `RegistryMultisig` self-governed signer rotation

**Files:**
- Modify: `contracts/src/RegistryMultisig.sol` (rotation already implemented in Task 1 — this task only adds the tests proving `onlySelf` semantics and invariants)
- Test: `contracts/test/RegistryMultisig.t.sol`

**Interfaces:**
- Consumes: `addOwner(address)`, `removeOwner(address)`, `changeThreshold(uint256)` (all `onlySelf`), from Task 1.
- Produces: no new symbols.

- [ ] **Step 1: Write the failing test**

Append to `contracts/test/RegistryMultisigTest` in `contracts/test/RegistryMultisig.t.sol`:

```solidity
    function _selfCall(bytes memory data) internal {
        vm.prank(a);
        uint256 id = ms.submit(address(ms), 0, data);
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
    }

    function testRotationRequiresSelfCall() public {
        // Direct call from an owner is rejected — must go through m-of-n.
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.OnlySelf.selector);
        ms.addOwner(address(0xD4));
    }

    function testAddOwnerViaMultisig() public {
        _selfCall(abi.encodeCall(RegistryMultisig.addOwner, (address(0xD4))));
        assertTrue(ms.isOwner(address(0xD4)));
        assertEq(ms.ownerCount(), 4);
    }

    function testRemoveOwnerViaMultisig() public {
        _selfCall(abi.encodeCall(RegistryMultisig.removeOwner, (c)));
        assertFalse(ms.isOwner(c));
        assertEq(ms.ownerCount(), 2);
    }

    function testRemoveOwnerBelowThresholdReverts() public {
        // 3 owners, threshold 2 → removing one is fine, removing to below threshold is not.
        _selfCall(abi.encodeCall(RegistryMultisig.removeOwner, (c))); // now 2 owners, threshold 2
        // Removing another would leave 1 owner < threshold 2 → inner call reverts → CallFailed.
        vm.prank(a);
        uint256 id = ms.submit(address(ms), 0, abi.encodeCall(RegistryMultisig.removeOwner, (b)));
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        vm.expectRevert(RegistryMultisig.CallFailed.selector);
        ms.execute(id);
    }

    function testChangeThresholdViaMultisig() public {
        _selfCall(abi.encodeCall(RegistryMultisig.changeThreshold, (uint256(3))));
        assertEq(ms.threshold(), 3);
    }
```

- [ ] **Step 2: Run test to verify it fails then passes**

Run: `cd contracts && forge test --match-contract RegistryMultisigTest -vv`
Expected: PASS — rotation already implemented in Task 1, so these tests confirm behavior. (If any fail, fix `RegistryMultisig.sol` before committing.)

- [ ] **Step 3: Commit**

```bash
git add contracts/test/RegistryMultisig.t.sol
git commit -m "test(contracts): cover RegistryMultisig self-governed rotation"
```

---

## Task 3: Governance integration (multisig + TimelockController + registry)

**Files:**
- Test: `contracts/test/Governance.t.sol`

**Interfaces:**
- Consumes: `RegistryMultisig` (Task 1), OZ `TimelockController` (`@openzeppelin/contracts/governance/TimelockController.sol`), `DiplomaRegistry` (unchanged).
- Produces: the canonical wiring pattern (proposers=[multisig], executors=[address(0)], admin=address(0)) reused by Task 4's deploy script.

- [ ] **Step 1: Write the failing test**

Create `contracts/test/Governance.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RegistryMultisig} from "../src/RegistryMultisig.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

contract GovernanceTest is Test {
    RegistryMultisig ms;
    TimelockController timelock;
    DiplomaRegistry registry;

    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    uint256 constant DELAY = 2 days;

    function setUp() public {
        address[] memory owners = new address[](3);
        owners[0] = a; owners[1] = b; owners[2] = c;
        ms = new RegistryMultisig(owners, 2);

        address[] memory proposers = new address[](1);
        proposers[0] = address(ms);
        address[] memory executors = new address[](1);
        executors[0] = address(0); // anyone can execute
        timelock = new TimelockController(DELAY, proposers, executors, address(0));

        // This test contract deploys the registry, so it is the initial owner.
        registry = new DiplomaRegistry();

        // Hand over ownership to the timelock (two-step).
        registry.transferOwnership(address(timelock));
        _governedCall(abi.encodeCall(DiplomaRegistry.acceptOwnership, ()), bytes32("accept"));
    }

    /// Route a registry call through m-of-n schedule → delay → execute.
    function _governedCall(bytes memory registryData, bytes32 salt) internal {
        bytes memory scheduleData = abi.encodeCall(
            TimelockController.schedule,
            (address(registry), 0, registryData, bytes32(0), salt, DELAY)
        );
        vm.prank(a);
        uint256 id = ms.submit(address(timelock), 0, scheduleData);
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id); // fires timelock.schedule

        vm.warp(block.timestamp + DELAY);
        timelock.execute(address(registry), 0, registryData, bytes32(0), salt); // anyone
    }

    function testGovernedOnboardIssuer() public {
        bytes memory data = abi.encodeCall(
            DiplomaRegistry.onboardIssuerAndUniversity,
            (address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1")
        );
        _governedCall(data, bytes32("onboard"));
        assertTrue(registry.isIssuer(address(0xD4)));
    }

    function testExecuteBeforeDelayReverts() public {
        bytes memory data = abi.encodeCall(
            DiplomaRegistry.onboardIssuerAndUniversity,
            (address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1")
        );
        bytes memory scheduleData = abi.encodeCall(
            TimelockController.schedule,
            (address(registry), 0, data, bytes32(0), bytes32("early"), DELAY)
        );
        vm.prank(a);
        uint256 id = ms.submit(address(timelock), 0, scheduleData);
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);

        // No warp: operation not ready yet.
        vm.expectRevert();
        timelock.execute(address(registry), 0, data, bytes32(0), bytes32("early"));
    }

    function testCancelDuringDelayPreventsExecution() public {
        bytes memory data = abi.encodeCall(DiplomaRegistry.removeIssuer, (address(0xD4)));
        bytes memory scheduleData = abi.encodeCall(
            TimelockController.schedule,
            (address(registry), 0, data, bytes32(0), bytes32("cancelme"), DELAY)
        );
        vm.prank(a);
        uint256 sid = ms.submit(address(timelock), 0, scheduleData);
        vm.prank(b);
        ms.confirm(sid);
        vm.prank(a);
        ms.execute(sid);

        bytes32 opId = timelock.hashOperation(address(registry), 0, data, bytes32(0), bytes32("cancelme"));
        bytes memory cancelData = abi.encodeCall(TimelockController.cancel, (opId));
        vm.prank(a);
        uint256 cid = ms.submit(address(timelock), 0, cancelData);
        vm.prank(b);
        ms.confirm(cid);
        vm.prank(a);
        ms.execute(cid);

        vm.warp(block.timestamp + DELAY);
        vm.expectRevert();
        timelock.execute(address(registry), 0, data, bytes32(0), bytes32("cancelme"));
    }

    function testDirectOwnerCallRevertsAfterHandover() public {
        // The old EOA (this test contract) is no longer owner.
        vm.expectRevert(DiplomaRegistry.OnlyOwner.selector);
        registry.removeIssuer(address(0xD4));
    }
}
```

- [ ] **Step 2: Run test to verify it fails, then passes**

Run: `cd contracts && forge test --match-contract GovernanceTest -vv`
Expected: PASS. (If `TimelockController` import fails, confirm `contracts/remappings.txt` has `@openzeppelin/=lib/openzeppelin-contracts/` and the path `lib/openzeppelin-contracts/contracts/governance/TimelockController.sol` exists.)

- [ ] **Step 3: Commit**

```bash
git add contracts/test/Governance.t.sol
git commit -m "test(contracts): governance integration (multisig+timelock+registry)"
```

---

## Task 4: Governance deploy script + ownership handover

**Files:**
- Create: `contracts/script/DeployGovernance.s.sol`

**Interfaces:**
- Consumes: `RegistryMultisig`, `TimelockController`, `DiplomaRegistry` (existing deployment address from env).
- Produces: writes `deployments/governance-<chainId>.json` with `multisig`, `timelock` addresses.

- [ ] **Step 1: Write the script**

Create `contracts/script/DeployGovernance.s.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Script.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RegistryMultisig} from "../src/RegistryMultisig.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

/// Deploys RegistryMultisig + TimelockController and hands DiplomaRegistry
/// ownership to the timelock. Reads:
///   REGISTRY_ADDRESS  — existing registry
///   GOV_OWNERS        — comma-separated owner addresses (via env in run())
///   GOV_THRESHOLD     — m
///   GOV_MIN_DELAY     — timelock delay in seconds
contract DeployGovernance is Script {
    function run() external {
        address registryAddr = vm.envAddress("REGISTRY_ADDRESS");
        address[] memory owners = vm.envAddress("GOV_OWNERS", ",");
        uint256 threshold = vm.envUint("GOV_THRESHOLD");
        uint256 minDelay = vm.envUint("GOV_MIN_DELAY");

        vm.startBroadcast();

        RegistryMultisig ms = new RegistryMultisig(owners, threshold);

        address[] memory proposers = new address[](1);
        proposers[0] = address(ms);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        TimelockController timelock = new TimelockController(minDelay, proposers, executors, address(0));

        // Step 1 of handover: current owner (broadcaster) sets pendingOwner.
        DiplomaRegistry(registryAddr).transferOwnership(address(timelock));

        vm.stopBroadcast();

        string memory path = string.concat(
            vm.projectRoot(), "/deployments/governance-", vm.toString(block.chainid), ".json"
        );
        string memory json = string.concat(
            "{\n",
            '  "chainId": ', vm.toString(block.chainid), ",\n",
            '  "multisig": "', vm.toString(address(ms)), '",\n',
            '  "timelock": "', vm.toString(address(timelock)), '",\n',
            '  "minDelay": ', vm.toString(minDelay), ",\n",
            '  "threshold": ', vm.toString(threshold), "\n",
            "}\n"
        );
        vm.writeFile(path, json);

        console2.log("RegistryMultisig:", address(ms));
        console2.log("TimelockController:", address(timelock));
        console2.log("Registry pendingOwner set to timelock. Run `gov bootstrap` to accept.");
    }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd contracts && forge build`
Expected: `Compiler run successful`.

- [ ] **Step 3: Dry-run against a local fork (no broadcast)**

Run:
```bash
cd contracts && \
REGISTRY_ADDRESS=0x0000000000000000000000000000000000000001 \
GOV_OWNERS=0xA1,0xB2,0xC3 GOV_THRESHOLD=2 GOV_MIN_DELAY=172800 \
forge script script/DeployGovernance.s.sol:DeployGovernance
```
Expected: simulation runs; prints multisig + timelock addresses. (No broadcast without `--broadcast` + `--rpc-url`.)

- [ ] **Step 4: Commit**

```bash
git add contracts/script/DeployGovernance.s.sol
git commit -m "feat(contracts): DeployGovernance script + ownership handover"
```

---

## Task 5: Add multisig + timelock ABIs to verifier-core

**Files:**
- Modify: `packages/verifier-core/src/abi.ts`
- Modify: `packages/verifier-core/src/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `RegistryMultisigAbi`, `TimelockControllerAbi` (both `as const`), exported from `@univerify/verifier-core`.

- [ ] **Step 1: Append ABIs to `packages/verifier-core/src/abi.ts`**

Append at the end of the file:

```typescript
export const RegistryMultisigAbi = [
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "OnlySelf", inputs: [] },
  { type: "error", name: "ZeroOwner", inputs: [] },
  { type: "error", name: "DuplicateOwner", inputs: [] },
  { type: "error", name: "UnknownOwner", inputs: [] },
  { type: "error", name: "InvalidThreshold", inputs: [] },
  { type: "error", name: "UnknownTx", inputs: [] },
  { type: "error", name: "AlreadyConfirmed", inputs: [] },
  { type: "error", name: "NotConfirmed", inputs: [] },
  { type: "error", name: "AlreadyExecuted", inputs: [] },
  { type: "error", name: "NotEnoughConfirmations", inputs: [] },
  { type: "error", name: "CallFailed", inputs: [] },
  {
    type: "function", name: "submit", stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "txId", type: "uint256" }],
  },
  { type: "function", name: "confirm", stateMutability: "nonpayable", inputs: [{ name: "txId", type: "uint256" }], outputs: [] },
  { type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [{ name: "txId", type: "uint256" }], outputs: [] },
  { type: "function", name: "execute", stateMutability: "nonpayable", inputs: [{ name: "txId", type: "uint256" }], outputs: [] },
  { type: "function", name: "addOwner", stateMutability: "nonpayable", inputs: [{ name: "newOwner", type: "address" }], outputs: [] },
  { type: "function", name: "removeOwner", stateMutability: "nonpayable", inputs: [{ name: "owner", type: "address" }], outputs: [] },
  { type: "function", name: "changeThreshold", stateMutability: "nonpayable", inputs: [{ name: "newThreshold", type: "uint256" }], outputs: [] },
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "ownerCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "txCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isOwner", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "confirmations", stateMutability: "view", inputs: [{ name: "", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function", name: "getTx", stateMutability: "view",
    inputs: [{ name: "txId", type: "uint256" }],
    outputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "executed", type: "bool" },
    ],
  },
  {
    type: "event", name: "Submitted", anonymous: false,
    inputs: [
      { name: "txId", type: "uint256", indexed: true },
      { name: "proposer", type: "address", indexed: true },
      { name: "target", type: "address", indexed: false },
      { name: "value", type: "uint256", indexed: false },
      { name: "data", type: "bytes", indexed: false },
    ],
  },
  { type: "event", name: "Confirmed", anonymous: false, inputs: [{ name: "txId", type: "uint256", indexed: true }, { name: "owner", type: "address", indexed: true }] },
  { type: "event", name: "Executed", anonymous: false, inputs: [{ name: "txId", type: "uint256", indexed: true }] },
] as const;

// Minimal subset of OZ 5.6.1 TimelockController used by UniVerify governance.
export const TimelockControllerAbi = [
  {
    type: "function", name: "schedule", stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
      { name: "delay", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "execute", stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "payload", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  {
    type: "function", name: "hashOperation", stateMutability: "pure",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  { type: "function", name: "getMinDelay", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getTimestamp", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isOperation", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isOperationPending", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isOperationReady", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isOperationDone", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "event", name: "CallScheduled", anonymous: false,
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "index", type: "uint256", indexed: true },
      { name: "target", type: "address", indexed: false },
      { name: "value", type: "uint256", indexed: false },
      { name: "data", type: "bytes", indexed: false },
      { name: "predecessor", type: "bytes32", indexed: false },
      { name: "delay", type: "uint256", indexed: false },
    ],
  },
  { type: "event", name: "Cancelled", anonymous: false, inputs: [{ name: "id", type: "bytes32", indexed: true }] },
] as const;
```

- [ ] **Step 2: Export from `packages/verifier-core/src/index.ts`**

Find the existing ABI export line (e.g. `export { DiplomaRegistryAbi } from "./abi.js";` or a barrel of `./abi`) and add the two names alongside it. If the file re-exports via `export * from "./abi.js";`, no change is needed — verify with the grep in Step 3.

```typescript
export { DiplomaRegistryAbi, RegistryMultisigAbi, TimelockControllerAbi } from "./abi.js";
```

- [ ] **Step 3: Build and verify exports**

Run:
```bash
npm -w @univerify/verifier-core run build && \
node -e "const m=require('./packages/verifier-core/dist/index.js'); console.log(!!m.RegistryMultisigAbi, !!m.TimelockControllerAbi)"
```
Expected: `true true`. (If the package is ESM-only, use `node --input-type=module -e "import('...').then(m=>console.log(!!m.RegistryMultisigAbi))"` matching the existing `.js` extension convention.)

- [ ] **Step 4: Commit**

```bash
git add packages/verifier-core/src/abi.ts packages/verifier-core/src/index.ts
git commit -m "feat(core): export RegistryMultisig + TimelockController ABIs"
```

---

## Task 6: SDK governance read helpers

**Files:**
- Modify: `packages/sdk/src/client.ts`
- Modify: `packages/sdk/src/index.ts`
- Test: `packages/sdk/src/client.test.ts`

**Interfaces:**
- Consumes: `RegistryMultisigAbi`, `TimelockControllerAbi` from `@univerify/verifier-core`; existing `SdkConfig`, public client.
- Produces on `UniverifySdk`:
  - `getMultisigInfo(multisig: Address): Promise<{ owners: Address[]; threshold: bigint; txCount: bigint }>`
  - `getMultisigTx(multisig: Address, txId: bigint): Promise<{ target: Address; value: bigint; data: Hex; executed: boolean; confirmations: bigint }>`
  - `getTimelockDelay(timelock: Address): Promise<bigint>`
  - `getOperationState(timelock: Address, id: Hex): Promise<{ state: "Unset" | "Pending" | "Ready" | "Done"; readyAt: bigint }>`
  - exported type `OperationState = "Unset" | "Pending" | "Ready" | "Done"`

- [ ] **Step 1: Write the failing test**

Append to `packages/sdk/src/client.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { UniverifySdk } from "./client.js";

describe("governance reads", () => {
  const sdk = new UniverifySdk({
    rpcUrl: "http://127.0.0.1:8545",
    registryAddress: "0x0000000000000000000000000000000000000001",
    chainId: 31337,
  });

  it("classifies operation state from timestamp", () => {
    // _classifyOperation is a pure helper: (timestamp, nowSeconds) -> state
    expect(sdk._classifyOperation(0n, 1000n).state).toBe("Unset");
    expect(sdk._classifyOperation(1n, 1000n).state).toBe("Done");
    expect(sdk._classifyOperation(2000n, 1000n).state).toBe("Pending");
    expect(sdk._classifyOperation(1000n, 1000n).state).toBe("Ready");
  });
});
```

(OZ semantics: timestamp `0` = Unset, `1` (the `_DONE_TIMESTAMP` sentinel) = Done, `> block.timestamp` = Pending, `<= block.timestamp` and `> 1` = Ready.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @univerify/sdk test -- client.test.ts`
Expected: FAIL — `_classifyOperation` is not a function.

- [ ] **Step 3: Implement helpers in `packages/sdk/src/client.ts`**

Add imports at the top (extend the existing verifier-core import):

```typescript
import {
  RegistryMultisigAbi,
  TimelockControllerAbi,
} from "@univerify/verifier-core";
```

Add the exported type near the other public types:

```typescript
export type OperationState = "Unset" | "Pending" | "Ready" | "Done";
```

Add these methods inside the `UniverifySdk` class (they use the existing private public client — reuse whatever the class already calls it, e.g. `this.client`):

```typescript
  /** Pure classifier for a timelock operation timestamp (OZ semantics). */
  _classifyOperation(timestamp: bigint, nowSeconds: bigint): { state: OperationState; readyAt: bigint } {
    if (timestamp === 0n) return { state: "Unset", readyAt: 0n };
    if (timestamp === 1n) return { state: "Done", readyAt: 0n };
    if (timestamp > nowSeconds) return { state: "Pending", readyAt: timestamp };
    return { state: "Ready", readyAt: timestamp };
  }

  async getMultisigInfo(multisig: Address) {
    const [owners, threshold, txCount] = await Promise.all([
      this.client.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "getOwners" }),
      this.client.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "threshold" }),
      this.client.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "txCount" }),
    ]);
    return { owners: owners as Address[], threshold: threshold as bigint, txCount: txCount as bigint };
  }

  async getMultisigTx(multisig: Address, txId: bigint) {
    const [tx, confirmations] = await Promise.all([
      this.client.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "getTx", args: [txId] }),
      this.client.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "confirmations", args: [txId] }),
    ]);
    const [target, value, data, executed] = tx as [Address, bigint, Hex, boolean];
    return { target, value, data, executed, confirmations: confirmations as bigint };
  }

  async getTimelockDelay(timelock: Address): Promise<bigint> {
    return (await this.client.readContract({
      address: timelock, abi: TimelockControllerAbi, functionName: "getMinDelay",
    })) as bigint;
  }

  async getOperationState(timelock: Address, id: Hex): Promise<{ state: OperationState; readyAt: bigint }> {
    const [timestamp, block] = await Promise.all([
      this.client.readContract({ address: timelock, abi: TimelockControllerAbi, functionName: "getTimestamp", args: [id] }) as Promise<bigint>,
      this.client.getBlock(),
    ]);
    return this._classifyOperation(timestamp, block.timestamp);
  }
```

If the class's public client field is not named `this.client`, adjust all four methods to the actual field name (grep `createPublicClient` in `client.ts`).

- [ ] **Step 4: Export the type from `packages/sdk/src/index.ts`**

Add `OperationState` to the existing `export type { ... } from "./client.js";` block.

- [ ] **Step 5: Run test to verify it passes + build**

Run: `npm -w @univerify/sdk test -- client.test.ts && npm -w @univerify/sdk run build`
Expected: PASS + clean build.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk/src/client.ts packages/sdk/src/index.ts packages/sdk/src/client.test.ts
git commit -m "feat(sdk): governance read helpers (multisig + timelock)"
```

---

## Task 7: CLI `gov` command group

**Files:**
- Create: `packages/verifier-cli/src/gov.ts`

**Interfaces:**
- Consumes: `RegistryMultisigAbi`, `TimelockControllerAbi`, `DiplomaRegistryAbi` from `@univerify/verifier-core`; env `RPC_URL`, `REGISTRY_ADDRESS`, `MULTISIG_ADDRESS`, `TIMELOCK_ADDRESS`, `GOV_PK`, `GOV_MIN_DELAY`.
- Produces: a runnable CLI: `node dist/gov.js <subcommand> [flags]`.

- [ ] **Step 1: Write the CLI**

Create `packages/verifier-cli/src/gov.ts`:

```typescript
import "dotenv/config";
import {
  createWalletClient, createPublicClient, http, encodeFunctionData,
  keccak256, toHex, isAddress, type Hex, type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  DiplomaRegistryAbi, RegistryMultisigAbi, TimelockControllerAbi,
} from "@univerify/verifier-core";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}
function requireFlag(name: string): string {
  const v = flag(name);
  if (!v) throw new Error(`Missing flag: ${name}`);
  return v;
}

const ZERO32 = ("0x" + "00".repeat(32)) as Hex;

function clients() {
  const rpc = requireEnv("RPC_URL");
  const account = privateKeyToAccount(requireEnv("GOV_PK") as Hex);
  const wallet = createWalletClient({ account, chain: sepolia, transport: http(rpc) });
  const pub = createPublicClient({ chain: sepolia, transport: http(rpc) });
  return { account, wallet, pub };
}

/** Build the inner registry calldata for a supported op. */
function buildRegistryCall(op: string): Hex {
  const registry = requireEnv("REGISTRY_ADDRESS") as Address;
  void registry;
  switch (op) {
    case "onboardIssuer":
      return encodeFunctionData({
        abi: DiplomaRegistryAbi, functionName: "onboardIssuerAndUniversity",
        args: [
          requireFlag("--issuer") as Address, BigInt(requireFlag("--university-id")),
          requireFlag("--name"), requireFlag("--country"),
          requireFlag("--website"), requireFlag("--accreditation"),
        ],
      });
    case "removeIssuer":
      return encodeFunctionData({
        abi: DiplomaRegistryAbi, functionName: "removeIssuer",
        args: [requireFlag("--issuer") as Address],
      });
    case "setUniversity":
      return encodeFunctionData({
        abi: DiplomaRegistryAbi, functionName: "setUniversity",
        args: [
          BigInt(requireFlag("--university-id")), Number(requireFlag("--status")),
          requireFlag("--name"), requireFlag("--country"),
          requireFlag("--website"), requireFlag("--accreditation"),
        ],
      });
    case "acceptOwnership":
      return encodeFunctionData({ abi: DiplomaRegistryAbi, functionName: "acceptOwnership", args: [] });
    default:
      throw new Error(`Unknown --op: ${op}`);
  }
}

function saltFor(label: string): Hex {
  return keccak256(toHex(label));
}

async function multisigSubmit(target: Address, data: Hex): Promise<Hex> {
  const { wallet } = clients();
  const multisig = requireEnv("MULTISIG_ADDRESS") as Address;
  return wallet.writeContract({
    address: multisig, abi: RegistryMultisigAbi, functionName: "submit",
    args: [target, 0n, data],
  });
}

async function main() {
  const cmd = process.argv[2];
  const multisig = () => requireEnv("MULTISIG_ADDRESS") as Address;
  const timelock = () => requireEnv("TIMELOCK_ADDRESS") as Address;

  switch (cmd) {
    case "propose": {
      const op = requireFlag("--op");
      const label = flag("--salt") ?? op;
      const registryData = buildRegistryCall(op);
      const delay = BigInt(process.env.GOV_MIN_DELAY ?? "172800");
      const scheduleData = encodeFunctionData({
        abi: TimelockControllerAbi, functionName: "schedule",
        args: [requireEnv("REGISTRY_ADDRESS") as Address, 0n, registryData, ZERO32, saltFor(label), delay],
      });
      const tx = await multisigSubmit(timelock(), scheduleData);
      const { pub } = clients();
      const opId = await pub.readContract({
        address: timelock(), abi: TimelockControllerAbi, functionName: "hashOperation",
        args: [requireEnv("REGISTRY_ADDRESS") as Address, 0n, registryData, ZERO32, saltFor(label)],
      });
      console.log("submitted multisig tx:", tx);
      console.log("operationId:", opId);
      console.log("salt label:", label);
      break;
    }
    case "confirm": {
      const { wallet } = clients();
      const tx = await wallet.writeContract({
        address: multisig(), abi: RegistryMultisigAbi, functionName: "confirm",
        args: [BigInt(requireFlag("--tx"))],
      });
      console.log("confirm tx:", tx);
      break;
    }
    case "exec-multisig": {
      const { wallet } = clients();
      const tx = await wallet.writeContract({
        address: multisig(), abi: RegistryMultisigAbi, functionName: "execute",
        args: [BigInt(requireFlag("--tx"))],
      });
      console.log("execute (multisig) tx:", tx);
      break;
    }
    case "execute": {
      const { wallet } = clients();
      const op = requireFlag("--op");
      const label = flag("--salt") ?? op;
      const registryData = buildRegistryCall(op);
      const tx = await wallet.writeContract({
        address: timelock(), abi: TimelockControllerAbi, functionName: "execute",
        args: [requireEnv("REGISTRY_ADDRESS") as Address, 0n, registryData, ZERO32, saltFor(label)],
      });
      console.log("timelock execute tx:", tx);
      break;
    }
    case "cancel": {
      const opId = requireFlag("--op-id") as Hex;
      const cancelData = encodeFunctionData({ abi: TimelockControllerAbi, functionName: "cancel", args: [opId] });
      const tx = await multisigSubmit(timelock(), cancelData);
      console.log("cancel proposal submitted (needs m-of-n + exec-multisig):", tx);
      break;
    }
    case "owner": {
      const sub = process.argv[3]; // add | remove
      const addr = requireFlag("--address") as Address;
      if (!isAddress(addr)) throw new Error("bad --address");
      const fn = sub === "add" ? "addOwner" : sub === "remove" ? "removeOwner" : undefined;
      if (!fn) throw new Error("usage: gov owner add|remove --address <addr>");
      const data = encodeFunctionData({ abi: RegistryMultisigAbi, functionName: fn, args: [addr] });
      console.log("owner-change proposal submitted:", await multisigSubmit(multisig(), data));
      break;
    }
    case "threshold": {
      const data = encodeFunctionData({
        abi: RegistryMultisigAbi, functionName: "changeThreshold", args: [BigInt(requireFlag("--value"))],
      });
      console.log("threshold-change proposal submitted:", await multisigSubmit(multisig(), data));
      break;
    }
    case "status": {
      const { pub } = clients();
      const [owners, threshold, txCount] = await Promise.all([
        pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "getOwners" }),
        pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "threshold" }),
        pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "txCount" }),
      ]);
      console.log("owners:", owners);
      console.log("threshold:", threshold?.toString());
      console.log("txCount:", txCount?.toString());
      for (let i = 0n; i < (txCount as bigint); i++) {
        const [t, conf] = await Promise.all([
          pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "getTx", args: [i] }),
          pub.readContract({ address: multisig(), abi: RegistryMultisigAbi, functionName: "confirmations", args: [i] }),
        ]);
        console.log(`tx#${i}`, { target: (t as any)[0], executed: (t as any)[3], confirmations: (conf as bigint).toString() });
      }
      break;
    }
    default:
      console.log("Usage: gov <propose|confirm|exec-multisig|execute|cancel|owner|threshold|status> [flags]");
      process.exit(1);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
```

- [ ] **Step 2: Build the CLI**

Run: `npm -w @univerify/verifier-core run build && npm -w @univerify/sdk run build && npm -w @univerify/verifier-cli run build`
Expected: clean build; `packages/verifier-cli/dist/gov.js` exists.

- [ ] **Step 3: Smoke-test the usage/help path**

Run: `node packages/verifier-cli/dist/gov.js`
Expected: prints the `Usage: gov ...` line and exits non-zero (no env needed for the help branch).

- [ ] **Step 4: Commit**

```bash
git add packages/verifier-cli/src/gov.ts
git commit -m "feat(cli): gov command group (propose/confirm/execute/cancel/rotate/status)"
```

---

## Task 8: Web governance library (reads + calldata + wallet writes)

**Files:**
- Create: `apps/web/lib/univerify/governance.ts`
- Create: `apps/web/lib/univerify/registryGovernanceWrite.ts`

**Interfaces:**
- Consumes: ABIs from `@univerify/verifier-core`; existing `makePublicClient` from `apps/web/lib/univerify/registry.ts`; wallet client from `apps/web/lib/univerify/wallet.ts`.
- Produces:
  - `governance.ts`: `readMultisigInfo(pub, multisig)`, `readMultisigTx(pub, multisig, txId)`, `readOperationState(pub, timelock, id)`, `buildScheduleCall(registry, registryData, salt, delay)`, `hashOp(pub, timelock, registry, registryData, salt)`, `saltFor(label)`, constant `ZERO32`.
  - `registryGovernanceWrite.ts`: `proposeChange(...)`, `confirmTx(...)`, `revokeTx(...)`, `execMultisig(...)`, `execTimelock(...)`, `cancelOp(...)` — each takes a common `{ multisig, timelock, registry, walletClient, publicClient, account, setTxState }` bundle.

- [ ] **Step 1: Create `apps/web/lib/univerify/governance.ts`**

```typescript
import { encodeFunctionData, keccak256, toHex, type Address, type Hex } from "viem";
import { RegistryMultisigAbi, TimelockControllerAbi } from "@univerify/verifier-core";
import type { makePublicClient } from "./registry";

export const ZERO32 = ("0x" + "00".repeat(32)) as Hex;
export type OperationState = "Unset" | "Pending" | "Ready" | "Done";

type Pub = ReturnType<typeof makePublicClient>;

export function saltFor(label: string): Hex {
  return keccak256(toHex(label));
}

export async function readMultisigInfo(pub: Pub, multisig: Address) {
  const [owners, threshold, txCount] = await Promise.all([
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "getOwners" }),
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "threshold" }),
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "txCount" }),
  ]);
  return { owners: owners as Address[], threshold: threshold as bigint, txCount: txCount as bigint };
}

export async function readMultisigTx(pub: Pub, multisig: Address, txId: bigint) {
  const [tx, confirmations] = await Promise.all([
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "getTx", args: [txId] }),
    pub.readContract({ address: multisig, abi: RegistryMultisigAbi, functionName: "confirmations", args: [txId] }),
  ]);
  const [target, value, data, executed] = tx as [Address, bigint, Hex, boolean];
  return { txId, target, value, data, executed, confirmations: confirmations as bigint };
}

export async function readOperationState(pub: Pub, timelock: Address, id: Hex): Promise<{ state: OperationState; readyAt: bigint }> {
  const [timestamp, block] = await Promise.all([
    pub.readContract({ address: timelock, abi: TimelockControllerAbi, functionName: "getTimestamp", args: [id] }) as Promise<bigint>,
    pub.getBlock(),
  ]);
  if (timestamp === 0n) return { state: "Unset", readyAt: 0n };
  if (timestamp === 1n) return { state: "Done", readyAt: 0n };
  if (timestamp > block.timestamp) return { state: "Pending", readyAt: timestamp };
  return { state: "Ready", readyAt: timestamp };
}

export function buildScheduleCall(registry: Address, registryData: Hex, salt: Hex, delay: bigint): Hex {
  return encodeFunctionData({
    abi: TimelockControllerAbi, functionName: "schedule",
    args: [registry, 0n, registryData, ZERO32, salt, delay],
  });
}

export async function hashOp(pub: Pub, timelock: Address, registry: Address, registryData: Hex, salt: Hex): Promise<Hex> {
  return (await pub.readContract({
    address: timelock, abi: TimelockControllerAbi, functionName: "hashOperation",
    args: [registry, 0n, registryData, ZERO32, salt],
  })) as Hex;
}
```

- [ ] **Step 2: Create `apps/web/lib/univerify/registryGovernanceWrite.ts`**

```typescript
import { type Address, type Hex } from "viem";
import { RegistryMultisigAbi, TimelockControllerAbi } from "@univerify/verifier-core";
import type { TxState } from "./types";
import type { makePublicClient } from "./registry";
import { buildScheduleCall, ZERO32 } from "./governance";

type Bundle = {
  multisig: Address;
  timelock: Address;
  registry: Address;
  account: Address;
  publicClient: ReturnType<typeof makePublicClient>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- viem WalletClient.writeContract generics
  walletClient: { writeContract: (args: any) => Promise<Hex> };
  setTxState: (s: TxState) => void;
};

async function send(b: Bundle, hash: Hex): Promise<Hex> {
  b.setTxState("pending");
  await b.publicClient.waitForTransactionReceipt({ hash });
  b.setTxState("success");
  return hash;
}

/** Propose a registry change: wrap in timelock.schedule, submit to multisig. */
export async function proposeChange(b: Bundle, registryData: Hex, salt: Hex, delay: bigint) {
  b.setTxState("submitting");
  const scheduleData = buildScheduleCall(b.registry, registryData, salt, delay);
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "submit",
    args: [b.timelock, 0n, scheduleData], account: b.account,
  });
  return send(b, hash);
}

export async function confirmTx(b: Bundle, txId: bigint) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "confirm", args: [txId], account: b.account,
  });
  return send(b, hash);
}

export async function revokeTx(b: Bundle, txId: bigint) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "revoke", args: [txId], account: b.account,
  });
  return send(b, hash);
}

export async function execMultisig(b: Bundle, txId: bigint) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "execute", args: [txId], account: b.account,
  });
  return send(b, hash);
}

export async function execTimelock(b: Bundle, registryData: Hex, salt: Hex) {
  b.setTxState("submitting");
  const hash = await b.walletClient.writeContract({
    address: b.timelock, abi: TimelockControllerAbi, functionName: "execute",
    args: [b.registry, 0n, registryData, ZERO32, salt], account: b.account,
  });
  return send(b, hash);
}

export async function cancelOp(b: Bundle, opId: Hex) {
  b.setTxState("submitting");
  const cancelData = (await import("viem")).encodeFunctionData({
    abi: TimelockControllerAbi, functionName: "cancel", args: [opId],
  });
  const hash = await b.walletClient.writeContract({
    address: b.multisig, abi: RegistryMultisigAbi, functionName: "submit",
    args: [b.timelock, 0n, cancelData], account: b.account,
  });
  return send(b, hash);
}
```

(If `TxState` in `types.ts` lacks a `"pending"` or `"submitting"` member, reuse the exact string-literal union already defined there — grep `type TxState` in `apps/web/lib/univerify/types.ts` and match its members.)

- [ ] **Step 3: Typecheck the web package**

Run: `cd apps/web && npx tsc --noEmit`
Expected: no errors in the two new files. (Fix any `TxState` literal mismatches per the note above.)

- [ ] **Step 4: Commit**

```bash
git add apps/web/lib/univerify/governance.ts apps/web/lib/univerify/registryGovernanceWrite.ts
git commit -m "feat(web): governance reads + wallet-write helpers"
```

---

## Task 9: `/admin` three-section governance UI

**Files:**
- Modify: `apps/web/app/admin/page.tsx`

**Interfaces:**
- Consumes: `governance.ts` reads, `registryGovernanceWrite.ts` writes, existing form encoders and wallet hookup already in `page.tsx`.
- Produces: rendered UI only.

- [ ] **Step 1: Add governance config + state**

Read `MULTISIG_ADDRESS` / `TIMELOCK_ADDRESS` from the web env module (extend `apps/web/lib/univerify/env.ts` to surface `multisigAddress`, `timelockAddress` — mirror how `registryAddress` is exposed). In `page.tsx`, load `readMultisigInfo` + iterate `readMultisigTx` for `[0..txCount)` into a `pendingTxs` state, and derive scheduled-op state via `readOperationState` for the ops the page knows about (track submitted `{ label, registryData, opId }` in local state keyed by salt label).

- [ ] **Step 2: Section (a) — propose change**

Reuse the existing university/issuer/remove forms. On submit, instead of the direct `writeIssuerAdminTx`, build `registryData` with the existing encoders, choose a human label (e.g. `onboard-<issuer>-<timestamp>`), and call `proposeChange(bundle, registryData, saltFor(label), minDelay)`. Persist `{ label, registryData }` so section (c) can execute it later.

- [ ] **Step 3: Section (b) — pending multisig txs**

Render `pendingTxs` (target, decoded action via `decodeFunctionData({ abi: TimelockControllerAbi | DiplomaRegistryAbi, data })`, `confirmations/threshold`, `executed`). Buttons: **Confirm** (`confirmTx`), **Revoke** (`revokeTx`), **Execute** (`execMultisig`, enabled when `confirmations >= threshold && !executed`). Disable actions when the connected wallet is not in `owners`.

- [ ] **Step 4: Section (c) — scheduled timelock ops**

For each tracked op, show `readOperationState` result and a live countdown to `readyAt` (a `setInterval` recomputing `readyAt - now`). Buttons: **Execute** (`execTimelock`, enabled when state === "Ready"; anyone) and **Cancel** (`cancelOp`, proposes an m-of-n cancel, enabled when state === "Pending").

- [ ] **Step 5: Manual verification (see Task 11 for the full local harness)**

Run: `cd apps/web && npm run dev`, open `/admin`, connect a wallet from the multisig owner set (against a local Anvil deploy). Confirm you can propose → confirm (second owner) → exec-multisig → (advance time) → execute, and see the issuer become active on `/verifier`.

- [ ] **Step 6: Lint + commit**

Run: `cd apps/web && npm run lint`
Expected: no new lint errors.

```bash
git add apps/web/app/admin/page.tsx apps/web/lib/univerify/env.ts
git commit -m "feat(web): /admin governance flow (propose/confirm/execute/cancel)"
```

---

## Task 10: Gas-overhead measurement + threat-model writeup

**Files:**
- Create: `contracts/test/GovernanceGas.t.sol`
- Create: `docs/governance-threat-model.md`

**Interfaces:**
- Consumes: `RegistryMultisig`, `TimelockController`, `DiplomaRegistry`.
- Produces: gas numbers (from `forge test --gas-report`) transcribed into the doc.

- [ ] **Step 1: Write the gas comparison test**

Create `contracts/test/GovernanceGas.t.sol`:

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RegistryMultisig} from "../src/RegistryMultisig.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

/// Measures gas for a single onboardIssuerAndUniversity via:
///  (1) direct EOA owner call (baseline, pre-governance)
///  (2) governed path: multisig.submit + confirm + execute (schedule) + timelock.execute
contract GovernanceGasTest is Test {
    address a = address(0xA1);
    address b = address(0xB2);
    uint256 constant DELAY = 2 days;

    function testGas_directOnboard() public {
        DiplomaRegistry reg = new DiplomaRegistry(); // this = owner
        reg.onboardIssuerAndUniversity(address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1");
    }

    function testGas_governedOnboard() public {
        address[] memory owners = new address[](2);
        owners[0] = a; owners[1] = b;
        RegistryMultisig ms = new RegistryMultisig(owners, 2);

        address[] memory proposers = new address[](1);
        proposers[0] = address(ms);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        TimelockController tl = new TimelockController(DELAY, proposers, executors, address(0));

        DiplomaRegistry reg = new DiplomaRegistry();
        reg.transferOwnership(address(tl));

        bytes memory accept = abi.encodeCall(DiplomaRegistry.acceptOwnership, ());
        _govern(ms, tl, address(reg), accept, bytes32("a"));

        bytes memory data = abi.encodeCall(
            DiplomaRegistry.onboardIssuerAndUniversity,
            (address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1")
        );
        _govern(ms, tl, address(reg), data, bytes32("o"));
        assertTrue(reg.isIssuer(address(0xD4)));
    }

    function _govern(RegistryMultisig ms, TimelockController tl, address reg, bytes memory data, bytes32 salt) internal {
        bytes memory scheduleData = abi.encodeCall(
            TimelockController.schedule, (reg, 0, data, bytes32(0), salt, DELAY)
        );
        vm.prank(a);
        uint256 id = ms.submit(address(tl), 0, scheduleData);
        vm.prank(b);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
        vm.warp(block.timestamp + DELAY);
        tl.execute(reg, 0, data, bytes32(0), salt);
    }
}
```

- [ ] **Step 2: Run and capture gas**

Run: `cd contracts && forge test --match-contract GovernanceGasTest --gas-report`
Expected: PASS; note the gas used by `testGas_directOnboard` vs `testGas_governedOnboard` and the per-function rows for `schedule`/`execute`/`submit`/`confirm`.

- [ ] **Step 3: Write the threat-model doc**

Create `docs/governance-threat-model.md`:

```markdown
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

<!-- transcribe the measured numbers from Step 2 -->
- Direct EOA `onboardIssuerAndUniversity`: **<GAS_DIRECT> gas**.
- Governed path (schedule + execute, excluding one-time deploy/handover): **<GAS_GOVERNED> gas**.
- Overhead per authorization change: **<GAS_GOVERNED − GAS_DIRECT> gas**.

Authorization changes are rare (issuer onboarding/removal), so this overhead is
amortized across every diploma that issuer later issues; it does not affect the
per-diploma issuance cost measured in the Phase 2 L2 benchmarks.

## Conclusion

The timelock makes authorization rewrites **non-silent, detectable, and revocable**,
and the m-of-n threshold removes the single-key failure mode — directly strengthening
the thesis's claim that UniVerify's marginal value over PKI is a public, append-only,
tamper-evident authorization log resistant to silent retroactive rewrite.
```

Replace the `<GAS_*>` placeholders with the measured values from Step 2.

- [ ] **Step 4: Commit**

```bash
git add contracts/test/GovernanceGas.t.sol docs/governance-threat-model.md
git commit -m "docs(governance): threat model + measured gas overhead"
```

---

## Task 11: Full-suite verification + local end-to-end

**Files:** none (verification only)

- [ ] **Step 1: Confirm registry is unmodified**

Run: `git log --oneline -- contracts/src/DiplomaRegistry.sol | head -1` and `git diff main --stat -- contracts/src/DiplomaRegistry.sol`
Expected: no diff to `DiplomaRegistry.sol` across this branch (preserves Phase 2 benchmarks).

- [ ] **Step 2: Full contract test suite**

Run: `cd contracts && forge test`
Expected: all tests pass (existing + `RegistryMultisigTest`, `GovernanceTest`, `GovernanceGasTest`).

- [ ] **Step 3: Full JS build + tests**

Run: `npm run build && npm test`
Expected: build succeeds in order core → sdk → cli → web; all vitest suites pass.

- [ ] **Step 4: Local end-to-end (Anvil)**

Run, in order:
```bash
anvil &                                   # local chain
# deploy registry (existing Deploy script) + governance (Task 4) against anvil,
# feeding GOV_OWNERS from anvil's default accounts, GOV_MIN_DELAY=5
# bootstrap ownership handover (accept) via the acceptOwnership op:
#   gov propose --op acceptOwnership  → gov confirm --tx <id> (2nd owner)
#   → gov exec-multisig --tx <id> → (wait 5s) → gov execute --op acceptOwnership
# then onboard an issuer the same way:
#   gov propose --op onboardIssuer --issuer .. --university-id 1 --name .. --country .. --website .. --accreditation ..
#   → gov confirm (2nd owner) → gov exec-multisig → (wait 5s) → gov execute --op onboardIssuer
```
Expected: after `gov execute`, `sdk.getIssuer(...)` / `/verifier` shows the new issuer active; a direct EOA `removeIssuer` reverts `OnlyOwner`.

- [ ] **Step 5: Commit any fixups, then open PR**

```bash
git add -A && git commit -m "chore(governance): finalize verification fixups"  # only if needed
```

---

## Self-Review Notes

- **Spec coverage:** RegistryMultisig core (T1) + rotation (T2); TimelockController wiring + all lifecycle paths schedule/execute/cancel/handover (T3); deploy + handover (T4); ABIs (T5); SDK reads (T6); CLI incl. rotation + status (T7); web reads/writes (T8) + three-section UI (T9); threat-model + gas (T10); registry-unchanged + e2e verification (T11). All spec sections mapped.
- **Bootstrap `acceptOwnership`** appears in T3 (test), T7 (`gov` `acceptOwnership` op + `propose`/`execute`), T10 (gas test) and T11 (e2e) — consistent salt/predecessor usage (`ZERO32`, per-label salt).
- **Type consistency:** `_classifyOperation` / `readOperationState` share identical OZ timestamp semantics across SDK (T6) and web (T8). `Bundle` fields in T8 are reused verbatim in T9. ABI function/event names in T5 match calls in T6–T9.
