// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DiplomaRegistryF2}  from "../src/DiplomaRegistryF2.sol";
import {DiplomaRegistry}    from "../src/DiplomaRegistry.sol";
import {DiplomaRegistryG}   from "../src/DiplomaRegistryG.sol";
import {DiplomaRegistryOZ}  from "../src/DiplomaRegistryOZ.sol";

/// @title VerificationComparison — 4-way side-by-side verification gas benchmark
/// @notice Compares verification cost across:
///   1. F2  — per-diploma model: status(docHash) — single SLOAD + bit masking
///   2. OZ  — OpenZeppelin MerkleProof: statusWithProof
///   3. Baseline — Custom Solidity Merkle: statusWithProof
///   4. G   — Assembly-optimised Merkle: statusWithProof

// ─────────────────────────────────────────────────────────────────────────────
// Shared Merkle tree helpers
// ─────────────────────────────────────────────────────────────────────────────

abstract contract MerkleHelperV is Test {
    function _buildTree(bytes32[] memory leaves)
        internal
        pure
        returns (bytes32 root, bytes32[][] memory levels)
    {
        uint256 n = leaves.length;
        uint256 depth = 0;
        { uint256 tmp = n; while (tmp > 1) { depth++; tmp >>= 1; } }

        levels = new bytes32[][](depth + 1);
        levels[0] = leaves;

        for (uint256 d = 0; d < depth; d++) {
            uint256 width = levels[d].length / 2;
            levels[d + 1] = new bytes32[](width);
            for (uint256 i = 0; i < width; i++) {
                bytes32 l = levels[d][2 * i];
                bytes32 r = levels[d][2 * i + 1];
                levels[d + 1][i] = l < r
                    ? keccak256(abi.encodePacked(l, r))
                    : keccak256(abi.encodePacked(r, l));
            }
        }
        root = levels[depth][0];
    }

    function _getProof(bytes32[][] memory levels, uint256 leafIndex)
        internal
        pure
        returns (bytes32[] memory proof)
    {
        uint256 depth = levels.length - 1;
        proof = new bytes32[](depth);
        uint256 idx = leafIndex;
        for (uint256 d = 0; d < depth; d++) {
            proof[d] = levels[d][(idx % 2 == 0) ? idx + 1 : idx - 1];
            idx /= 2;
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// F2 — Per-diploma verification (constant cost, no proof depth)
// ─────────────────────────────────────────────────────────────────────────────

contract VerifyF2Test is Test {
    DiplomaRegistryF2 reg;

    address owner   = address(this);
    address issuer  = address(0xB0B);
    bytes32 docHash = keccak256("diploma-1");

    function setUp() public {
        reg = new DiplomaRegistryF2();
        reg.addIssuer(issuer);
        vm.prank(issuer);
        reg.issue(docHash);
    }

    function testVerify_F2_status() public view {
        DiplomaRegistryF2.Status s = reg.status(docHash);
        assert(s == DiplomaRegistryF2.Status.Valid);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Baseline — Custom Solidity Merkle verification
// ─────────────────────────────────────────────────────────────────────────────

contract VerifyBaselineTest is MerkleHelperV {
    DiplomaRegistry reg;

    address issuer = address(0xB0B);
    uint64  constant BATCH = 1;

    function setUp() public {
        reg = new DiplomaRegistry();
        reg.onboardIssuerAndUniversity(issuer, 1001, "PW", "PL", "https://pw.edu.pl", "PKA-001");
    }

    function testVerify_Baseline_Depth0() public {
        vm.pauseGasMetering();
        bytes32 doc = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32 leaf = reg.merkleLeaf(doc, BATCH, issuer);
        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, leaf);

        bytes32[] memory proof = new bytes32[](0);
        vm.resumeGasMetering();
        DiplomaRegistry.Status s = reg.statusWithProof(doc, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }

    function testVerify_Baseline_Depth1() public {
        _verifyAtDepth(2);
    }

    function testVerify_Baseline_Depth4() public {
        _verifyAtDepth(16);
    }

    function testVerify_Baseline_Depth8() public {
        _verifyAtDepth(256);
    }

    function _verifyAtDepth(uint256 n) internal {
        vm.pauseGasMetering();
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            leaves[i] = reg.merkleLeaf(keccak256(abi.encodePacked("doc", i)), BATCH, issuer);
        }
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.resumeGasMetering();
        DiplomaRegistry.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// G — Assembly-optimised Merkle verification
// ─────────────────────────────────────────────────────────────────────────────

contract VerifyGTest is MerkleHelperV {
    DiplomaRegistryG reg;

    address issuer = address(0xB0B);
    uint64  constant BATCH = 1;

    function setUp() public {
        reg = new DiplomaRegistryG();
        reg.onboardIssuerAndUniversity(issuer, 1001, "PW", "PL", "https://pw.edu.pl", "PKA-001");
    }

    function testVerify_G_Depth0() public {
        vm.pauseGasMetering();
        bytes32 doc = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32 leaf = reg.merkleLeaf(doc, BATCH, issuer);
        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, leaf);

        bytes32[] memory proof = new bytes32[](0);
        vm.resumeGasMetering();
        DiplomaRegistryG.Status s = reg.statusWithProof(doc, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }

    function testVerify_G_Depth1() public {
        _verifyAtDepth(2);
    }

    function testVerify_G_Depth4() public {
        _verifyAtDepth(16);
    }

    function testVerify_G_Depth8() public {
        _verifyAtDepth(256);
    }

    function _verifyAtDepth(uint256 n) internal {
        vm.pauseGasMetering();
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            leaves[i] = reg.merkleLeaf(keccak256(abi.encodePacked("doc", i)), BATCH, issuer);
        }
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.resumeGasMetering();
        DiplomaRegistryG.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// OZ — OpenZeppelin MerkleProof verification
// ─────────────────────────────────────────────────────────────────────────────

contract VerifyOZTest is MerkleHelperV {
    DiplomaRegistryOZ reg;

    address issuer = address(0xB0B);
    uint64  constant BATCH = 1;

    function setUp() public {
        reg = new DiplomaRegistryOZ();
        reg.onboardIssuerAndUniversity(issuer, 1001, "PW", "PL", "https://pw.edu.pl", "PKA-001");
    }

    function testVerify_OZ_Depth0() public {
        vm.pauseGasMetering();
        bytes32 doc = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32 leaf = reg.merkleLeaf(doc, BATCH, issuer);
        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, leaf);

        bytes32[] memory proof = new bytes32[](0);
        vm.resumeGasMetering();
        DiplomaRegistryOZ.Status s = reg.statusWithProof(doc, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryOZ.Status.Valid));
    }

    function testVerify_OZ_Depth1() public {
        _verifyAtDepth(2);
    }

    function testVerify_OZ_Depth4() public {
        _verifyAtDepth(16);
    }

    function testVerify_OZ_Depth8() public {
        _verifyAtDepth(256);
    }

    function _verifyAtDepth(uint256 n) internal {
        vm.pauseGasMetering();
        bytes32[] memory leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            leaves[i] = reg.merkleLeaf(keccak256(abi.encodePacked("doc", i)), BATCH, issuer);
        }
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.resumeGasMetering();
        DiplomaRegistryOZ.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryOZ.Status.Valid));
    }
}
