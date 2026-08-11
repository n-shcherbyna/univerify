// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DiplomaRegistry}  from "../src/DiplomaRegistry.sol";
import {DiplomaRegistryG} from "../src/DiplomaRegistryG.sol";

/// Isolated cost of the public `merkleLeaf` view (thesis ch. 4, technique G4).
/// Other suites call `merkleLeaf` under `vm.pauseGasMetering`, so the gas report
/// shows 0 there; this suite measures it with metering on.
contract MerkleLeafGasTest is Test {
    DiplomaRegistry  base;
    DiplomaRegistryG g;

    address constant ISSUER = address(0xB0B);
    uint64  constant BATCH  = 1;
    bytes32 constant DOC    = keccak256("diploma-1");

    function setUp() public {
        base = new DiplomaRegistry();
        g    = new DiplomaRegistryG();
    }

    function testGas_merkleLeaf_baseline() public view {
        base.merkleLeaf(DOC, BATCH, ISSUER);
    }

    function testGas_merkleLeaf_G() public view {
        g.merkleLeaf(DOC, BATCH, ISSUER);
    }

    /// G4 replaces `abi.encodePacked` with hand-rolled `mstore`s. The invariant
    /// is that both still hash the same 112-byte preimage. The leaf binds
    /// `address(this)`, so the two contracts cannot produce the same value —
    /// each is checked against the reference encoding at its own address.
    function testLeafMatchesReferenceEncoding() public view {
        assertEq(
            base.merkleLeaf(DOC, BATCH, ISSUER),
            keccak256(abi.encodePacked(address(base), block.chainid, ISSUER, BATCH, DOC)),
            "baseline leaf diverges from abi.encodePacked reference"
        );
        assertEq(
            g.merkleLeaf(DOC, BATCH, ISSUER),
            keccak256(abi.encodePacked(address(g), block.chainid, ISSUER, BATCH, DOC)),
            "G4 assembly packing diverges from abi.encodePacked reference"
        );
    }
}
