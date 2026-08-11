// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../src/DiplomaRegistryB.sol";

contract DiplomaRegistryBGasTest is Test {
    DiplomaRegistryB reg;

    address owner = address(0xA11CE);
    address issuer = address(0xB0B);

    bytes32 docHash = keccak256("diploma-1");

    function setUp() public {
        vm.prank(owner);
        reg = new DiplomaRegistryB();

        vm.prank(owner);
        reg.addIssuer(issuer);
    }

    function testGas_issue() public {
        vm.prank(issuer);
        reg.issue(docHash);
    }

    function testGas_revoke() public {
        vm.prank(issuer);
        reg.issue(docHash);

        vm.prank(issuer);
        reg.revoke(docHash);
    }

    function testGas_addIssuer() public {
        vm.prank(owner);
        reg.addIssuer(address(0xCAFE));
    }

    function testGas_removeIssuer() public {
        vm.prank(owner);
        reg.removeIssuer(issuer);
    }
}
