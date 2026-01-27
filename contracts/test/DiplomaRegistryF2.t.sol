// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/DiplomaRegistryF2.sol";

contract DiplomaRegistryFGasTest is Test {
    DiplomaRegistryF2 reg;

    address owner = address(0xA11CE);
    address issuer1 = address(0xB0B);
    address issuer2 = address(0xB0B2);
    address attacker = address(0xBAD);

    bytes32 docHash = keccak256("diploma-1");

    function setUp() public {
        vm.prank(owner);
        reg = new DiplomaRegistryF2();

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
        vm.expectRevert(DiplomaRegistryF2.OnlyOwner.selector);
        reg.addIssuer(address(0xCAFE));
    }

    function testGasRevert_removeIssuer_onlyOwner() public {
        vm.prank(attacker);
        vm.expectRevert(DiplomaRegistryF2.OnlyOwner.selector);
        reg.removeIssuer(issuer1);
    }

    // OnlyIssuer
    function testGasRevert_issue_onlyIssuer() public {
        vm.prank(attacker);
        vm.expectRevert(DiplomaRegistryF2.OnlyIssuer.selector);
        reg.issue(docHash);
    }

    // AlreadyIssued
    function testGasRevert_issue_alreadyIssued() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistryF2.AlreadyIssued.selector);
        reg.issue(docHash);
    }

    // AlreadyRevoked
    function testGasRevert_revoke_alreadyRevoked() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer1);
        reg.revoke(docHash);

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistryF2.AlreadyRevoked.selector);
        reg.revoke(docHash);
    }

    // NotIssuerOfRecord
    function testGasRevert_revoke_notIssuerOfRecord() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer2);
        vm.expectRevert(DiplomaRegistryF2.NotIssuerOfRecord.selector);
        reg.revoke(docHash);
    }
    function testGas_addIssuer_twice_idempotent() public {
        vm.prank(owner);
        reg.addIssuer(address(0xCAFE));
        vm.prank(owner);
        reg.addIssuer(address(0xCAFE));
    }

    function testGas_removeIssuer_twice_idempotent() public {
        vm.prank(owner);
        reg.addIssuer(address(0xCAFE));
        vm.prank(owner);
        reg.removeIssuer(address(0xCAFE));
        vm.prank(owner);
        reg.removeIssuer(address(0xCAFE));
    }

    function testGas_statusIssued() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        reg.status(docHash);
    }

    function testGas_statusRevoked() public {
        vm.prank(issuer1);
        reg.issue(docHash);

        vm.prank(issuer1);
        reg.revoke(docHash);

        reg.status(docHash);
    }

    function testGas_statusNeverIssued() public {
        reg.status(docHash);
    }
}
