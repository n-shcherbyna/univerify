// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DiplomaRegistry}  from "../src/DiplomaRegistry.sol";
import {DiplomaRegistryG} from "../src/DiplomaRegistryG.sol";

// ─────────────────────────────────────────────────────────────────────────────
// Shared Merkle tree helpers
// ─────────────────────────────────────────────────────────────────────────────

abstract contract MerkleHelper is Test {
    /// @dev Build a balanced Merkle tree of n leaves (n = power of 2).
    ///      levels[0] = leaf layer; levels[depth] = root layer.
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
// Baseline — DiplomaRegistry
// ─────────────────────────────────────────────────────────────────────────────

contract BaselineGasTest is MerkleHelper {
    DiplomaRegistry reg;

    address issuer = address(0xB0B);
    uint64  constant BATCH = 1;

    function setUp() public {
        reg = new DiplomaRegistry();
        reg.onboardIssuerAndUniversity(issuer, 1001, "Politechnika Warszawska", "PL", "https://pw.edu.pl", "PKA-001");
    }

    // ── issueBatchRoot ──────────────────────────────────────────────────────

    function testIssueBatchRoot() public {
        bytes32 root = keccak256("root");
        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);
    }

    // ── revokeFromBatch ─────────────────────────────────────────────────────

    function testRevokeFromBatch_Depth0() public {
        // Single-leaf batch: empty proof
        bytes32 doc = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32 leaf = reg.merkleLeaf(doc, BATCH, issuer);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, leaf); // root == leaf for single-diploma batch

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc, BATCH, proof);
    }

    function testRevokeFromBatch_Depth1() public {
        bytes32[] memory leaves = _makeLeaves(2);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    function testRevokeFromBatch_Depth4() public {
        bytes32[] memory leaves = _makeLeaves(16);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    function testRevokeFromBatch_Depth8() public {
        bytes32[] memory leaves = _makeLeaves(256);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    // ── statusWithProof ─────────────────────────────────────────────────────

    function testStatusWithProof_Depth0() public {
        bytes32 doc = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32 leaf = reg.merkleLeaf(doc, BATCH, issuer);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, leaf);

        bytes32[] memory proof = new bytes32[](0);
        DiplomaRegistry.Status s = reg.statusWithProof(doc, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }

    function testStatusWithProof_Depth1() public {
        bytes32[] memory leaves = _makeLeaves(2);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistry.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }

    function testStatusWithProof_Depth4() public {
        bytes32[] memory leaves = _makeLeaves(16);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistry.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }

    function testStatusWithProof_Depth8() public {
        bytes32[] memory leaves = _makeLeaves(256);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistry.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }

    // ── revokeFromBatch (extended depths) ───────────────────────────────────

    function testRevokeFromBatch_Depth10() public {
        bytes32[] memory leaves = _makeLeaves(1024);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    function testRevokeFromBatch_Depth12() public {
        bytes32[] memory leaves = _makeLeaves(4096);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    // ── statusWithProof (extended depths) ────────────────────────────────────

    function testStatusWithProof_Depth10() public {
        bytes32[] memory leaves = _makeLeaves(1024);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistry.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }

    function testStatusWithProof_Depth12() public {
        bytes32[] memory leaves = _makeLeaves(4096);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistry.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistry.Status.Valid));
    }

    // ── helper ──────────────────────────────────────────────────────────────

    function _makeLeaves(uint256 n) internal view returns (bytes32[] memory leaves) {
        leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes32 doc = keccak256(abi.encodePacked("doc", i));
            leaves[i] = reg.merkleLeaf(doc, BATCH, issuer);
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Optimised — DiplomaRegistryG
// ─────────────────────────────────────────────────────────────────────────────

contract OptimisedGasTest is MerkleHelper {
    DiplomaRegistryG reg;

    address issuer = address(0xB0B);
    uint64  constant BATCH = 1;

    function setUp() public {
        reg = new DiplomaRegistryG();
        reg.onboardIssuerAndUniversity(issuer, 1001, "Politechnika Warszawska", "PL", "https://pw.edu.pl", "PKA-001");
    }

    // ── issueBatchRoot ──────────────────────────────────────────────────────

    function testIssueBatchRoot() public {
        bytes32 root = keccak256("root");
        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);
    }

    // ── revokeFromBatch ─────────────────────────────────────────────────────

    function testRevokeFromBatch_Depth0() public {
        bytes32 doc = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32 leaf = reg.merkleLeaf(doc, BATCH, issuer);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, leaf);

        bytes32[] memory proof = new bytes32[](0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc, BATCH, proof);
    }

    function testRevokeFromBatch_Depth1() public {
        bytes32[] memory leaves = _makeLeaves(2);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    function testRevokeFromBatch_Depth4() public {
        bytes32[] memory leaves = _makeLeaves(16);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    function testRevokeFromBatch_Depth8() public {
        bytes32[] memory leaves = _makeLeaves(256);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    // ── statusWithProof ─────────────────────────────────────────────────────

    function testStatusWithProof_Depth0() public {
        bytes32 doc = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32 leaf = reg.merkleLeaf(doc, BATCH, issuer);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, leaf);

        bytes32[] memory proof = new bytes32[](0);
        DiplomaRegistryG.Status s = reg.statusWithProof(doc, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }

    function testStatusWithProof_Depth1() public {
        bytes32[] memory leaves = _makeLeaves(2);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistryG.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }

    function testStatusWithProof_Depth4() public {
        bytes32[] memory leaves = _makeLeaves(16);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistryG.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }

    function testStatusWithProof_Depth8() public {
        bytes32[] memory leaves = _makeLeaves(256);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistryG.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }

    // ── revokeFromBatch (extended depths) ───────────────────────────────────

    function testRevokeFromBatch_Depth10() public {
        bytes32[] memory leaves = _makeLeaves(1024);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    function testRevokeFromBatch_Depth12() public {
        bytes32[] memory leaves = _makeLeaves(4096);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        vm.prank(issuer);
        reg.revokeFromBatch(doc0, BATCH, proof);
    }

    // ── statusWithProof (extended depths) ────────────────────────────────────

    function testStatusWithProof_Depth10() public {
        bytes32[] memory leaves = _makeLeaves(1024);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistryG.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }

    function testStatusWithProof_Depth12() public {
        bytes32[] memory leaves = _makeLeaves(4096);
        (bytes32 root, bytes32[][] memory levels) = _buildTree(leaves);

        vm.prank(issuer);
        reg.issueBatchRoot(BATCH, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);
        DiplomaRegistryG.Status s = reg.statusWithProof(doc0, issuer, BATCH, proof);
        assertEq(uint256(s), uint256(DiplomaRegistryG.Status.Valid));
    }

    // ── helper ──────────────────────────────────────────────────────────────

    function _makeLeaves(uint256 n) internal view returns (bytes32[] memory leaves) {
        leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes32 doc = keccak256(abi.encodePacked("doc", i));
            leaves[i] = reg.merkleLeaf(doc, BATCH, issuer);
        }
    }
}
