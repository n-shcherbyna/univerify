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
