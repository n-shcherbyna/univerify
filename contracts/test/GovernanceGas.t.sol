// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {RegistryMultisig} from "../src/RegistryMultisig.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

/// Measures gas for a single `onboardIssuerAndUniversity` under two ownership models.
///
/// Each `testGas_*` body contains ONLY the one operation being measured; all
/// deployment and one-time governance bootstrap happens in `setUp()`, so the
/// per-test gas figure and each function row in `--gas-report` is a clean,
/// single-round, directly-reported number requiring no disaggregation.
///
///  - testGas_directOnboard  : direct EOA owner call (baseline, pre-governance)
///  - testGas_governedOnboard: full governed path for ONE onboard —
///        multisig.submit + multisig.confirm + multisig.execute (schedule) + timelock.execute
///
/// The governed total is the sum of the four function rows in that test's
/// --gas-report; the governance overhead is (governed total − direct baseline).
contract GovernanceGasTest is Test {
    address a = address(0xA1);
    address b = address(0xB2);
    uint256 constant DELAY = 2 days;

    // Deployed once in setUp(); the registry is already owned by the timelock
    // (ownership handover accepted) before any gas measurement begins.
    RegistryMultisig ms;
    TimelockController tl;
    DiplomaRegistry regDirect; // EOA-owned, for the direct baseline
    DiplomaRegistry regGoverned; // timelock-owned, for the governed path

    function setUp() public {
        // Direct baseline registry: owned by this test contract (EOA-equivalent).
        regDirect = new DiplomaRegistry();

        // Governance stack.
        address[] memory owners = new address[](2);
        owners[0] = a;
        owners[1] = b;
        ms = new RegistryMultisig(owners, 2);

        address[] memory proposers = new address[](1);
        proposers[0] = address(ms);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        tl = new TimelockController(DELAY, proposers, executors, address(0));

        // Hand the governed registry to the timelock and complete the two-step
        // transfer through governance. This bootstrap is intentionally OUTSIDE
        // the measured test bodies.
        regGoverned = new DiplomaRegistry();
        regGoverned.transferOwnership(address(tl));
        _govern(address(regGoverned), abi.encodeCall(DiplomaRegistry.acceptOwnership, ()), bytes32("bootstrap"));
    }

    /// Baseline: what a single onboard costs when the registry owner is a plain EOA.
    function testGas_directOnboard() public {
        regDirect.onboardIssuerAndUniversity(address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1");
    }

    /// Governed: the full four-call cost of the SAME onboard through m-of-n + timelock.
    /// The reported per-test total is the governed cost of one onboard. Each of the
    /// four calls reverts on failure, so a passing test proves the path executed;
    /// correctness of the resulting state is asserted separately in Governance.t.sol.
    function testGas_governedOnboard() public {
        bytes memory data = abi.encodeCall(
            DiplomaRegistry.onboardIssuerAndUniversity,
            (address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1")
        );
        _govern(address(regGoverned), data, bytes32("onboard"));
    }

    function _govern(address reg, bytes memory data, bytes32 salt) internal {
        bytes memory scheduleData =
            abi.encodeCall(TimelockController.schedule, (reg, 0, data, bytes32(0), salt, DELAY));
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

/// Same measurement at the deployment-target threshold (3-of-5).
///
/// Kept as a separate, straight-line contract rather than a parametrised
/// subclass so that the 2-of-2 figures above stay byte-identical: any loop or
/// configuration lookup inside the measured body would add test-harness gas
/// that is not an on-chain cost.
///
/// `RegistryMultisig.execute` recounts confirmations by iterating over the
/// current owner set, so the governed path here is strictly more expensive
/// than the 2-of-2 case; two extra `confirm` transactions are needed as well.
contract GovernanceGas3of5Test is Test {
    address a = address(0xA1);
    address b = address(0xB2);
    address c = address(0xC3);
    address d = address(0xD5);
    address e = address(0xE6);
    uint256 constant DELAY = 2 days;

    RegistryMultisig ms;
    TimelockController tl;
    DiplomaRegistry regDirect;
    DiplomaRegistry regGoverned;

    function setUp() public {
        regDirect = new DiplomaRegistry();

        address[] memory owners = new address[](5);
        owners[0] = a;
        owners[1] = b;
        owners[2] = c;
        owners[3] = d;
        owners[4] = e;
        ms = new RegistryMultisig(owners, 3);

        address[] memory proposers = new address[](1);
        proposers[0] = address(ms);
        address[] memory executors = new address[](1);
        executors[0] = address(0);
        tl = new TimelockController(DELAY, proposers, executors, address(0));

        regGoverned = new DiplomaRegistry();
        regGoverned.transferOwnership(address(tl));
        _govern(address(regGoverned), abi.encodeCall(DiplomaRegistry.acceptOwnership, ()), bytes32("bootstrap"));
    }

    function testGas_directOnboard() public {
        regDirect.onboardIssuerAndUniversity(address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1");
    }

    function testGas_governedOnboard() public {
        bytes memory data = abi.encodeCall(
            DiplomaRegistry.onboardIssuerAndUniversity,
            (address(0xD4), 1, "PW", "PL", "https://pw.edu.pl", "PKA-1")
        );
        _govern(address(regGoverned), data, bytes32("onboard"));
    }

    function _govern(address reg, bytes memory data, bytes32 salt) internal {
        bytes memory scheduleData =
            abi.encodeCall(TimelockController.schedule, (reg, 0, data, bytes32(0), salt, DELAY));
        vm.prank(a);
        uint256 id = ms.submit(address(tl), 0, scheduleData); // counts as a's confirmation
        vm.prank(b);
        ms.confirm(id);
        vm.prank(c);
        ms.confirm(id);
        vm.prank(a);
        ms.execute(id);
        vm.warp(block.timestamp + DELAY);
        tl.execute(reg, 0, data, bytes32(0), salt);
    }
}
