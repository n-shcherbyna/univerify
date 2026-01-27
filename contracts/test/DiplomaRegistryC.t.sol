// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/DiplomaRegistryC.sol";

contract DiplomaRegistryCGasTest is Test {
    DiplomaRegistryC reg;

    address owner    = address(0xA11CE);
    address issuer1  = address(0xB0B);
    address issuer2  = address(0xB0B2);
    address attacker = address(0xBAD);

    bytes32 docHash = keccak256("diploma-1");

    function setUp() public {
        vm.prank(owner);
        reg = new DiplomaRegistryC();

        vm.prank(owner);
        reg.addIssuer(issuer1);

        vm.prank(owner);
        reg.addIssuer(issuer2);
    }

    // =========================
    // Happy-path gas
    // =========================

    function testGas_addIssuer() public {
        vm.prank(owner);
        reg.addIssuer(address(0xCAFE));
    }

    function testGas_removeIssuer() public {
        vm.prank(owner);
        reg.removeIssuer(issuer2);
    }

    function testGas_issue() public {
        vm.prank(issuer1);
        reg.issue(docHash);
    }

    function testGas_revoke() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer1);
        reg.revoke(docHash);
    }

    // =========================
    // Revert-path gas
    // =========================

    // OnlyOwner
    function testGasRevert_addIssuer_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(DiplomaRegistryC.OnlyOwner.selector);
        reg.addIssuer(address(0xCAFE));
    }

    function testGasRevert_removeIssuer_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(DiplomaRegistryC.OnlyOwner.selector);
        reg.removeIssuer(issuer1);
    }

    // OnlyIssuer
    function testGasRevert_issue_onlyIssuer() public {
        vm.prank(attacker);
        vm.expectRevert(DiplomaRegistryC.OnlyIssuer.selector);
        reg.issue(docHash);
    }

    // AlreadyIssued
    function testGasRevert_issue_alreadyIssued() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistryC.AlreadyIssued.selector);
        reg.issue(docHash);
    }

    // AlreadyRevoked
    function testGasRevert_revoke_alreadyRevoked() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer1);
        reg.revoke(docHash);

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistryC.AlreadyRevoked.selector);
        reg.revoke(docHash);
    }

    // NotIssuerOfRecord (IMPORTANT: caller IS an issuer, but not the issuer of this record)
    function testGasRevert_revoke_notIssuerOfRecord() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer2);
        vm.expectRevert(DiplomaRegistryC.NotIssuerOfRecord.selector);
        reg.revoke(docHash);
    }
}
