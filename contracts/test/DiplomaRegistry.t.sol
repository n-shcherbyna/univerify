// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

contract DiplomaRegistryTest is Test {
    DiplomaRegistry reg;

    address owner = address(this);      // test contract jest ownerem (deployuje)
    address issuer = address(0xB0B);
    address other  = address(0xCAFE);

    function setUp() public {
        reg = new DiplomaRegistry();
        reg.addIssuer(issuer);
    }

    function testUnknownForMissing() public view {
        bytes32 h = keccak256("missing");
        assertEq(uint256(reg.status(h)), uint256(DiplomaRegistry.Status.Unknown));
    }

    function testIssueRevokeFlow() public {
        bytes32 h = keccak256("payload-v1");

        // non-issuer cannot issue
        vm.prank(other);
        vm.expectRevert(bytes("ONLY_ISSUER"));
        reg.issue(h);

        // issuer issues
        vm.prank(issuer);
        reg.issue(h);
        assertEq(uint256(reg.status(h)), uint256(DiplomaRegistry.Status.Valid));

        // cannot issue twice
        vm.prank(issuer);
        vm.expectRevert(bytes("ALREADY_ISSUED"));
        reg.issue(h);

        // issuer revokes
        vm.prank(issuer);
        reg.revoke(h);
        assertEq(uint256(reg.status(h)), uint256(DiplomaRegistry.Status.Revoked));
    }

    function testOnlyIssuerOfRecordCanRevoke() public {
        address issuer2 = address(0xD00D);

        // owner adds issuer2
        reg.addIssuer(issuer2);

        bytes32 h = keccak256("x");

        vm.prank(issuer);
        reg.issue(h);

        // issuer2 has issuer role but didn't issue this hash
        vm.prank(issuer2);
        vm.expectRevert(bytes("NOT_ISSUER_OF_RECORD"));
        reg.revoke(h);
    }
}
