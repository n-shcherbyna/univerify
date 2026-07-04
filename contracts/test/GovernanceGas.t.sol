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
