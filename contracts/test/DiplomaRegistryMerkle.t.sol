// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

contract DiplomaRegistryMerkleTest is Test {
    event UniversitySet(
        uint64 indexed universityId,
        DiplomaRegistry.UniversityStatus indexed status,
        string name,
        string country,
        string website,
        string accreditationId
    );

    DiplomaRegistry reg;

    address issuer1 = address(0xB0B);
    address issuer2 = address(0xB0B2);
    address outsider = address(0xCAFE);

    uint64 batchId = 1;
    bytes32 docA = keccak256("doc-a");
    bytes32 docB = keccak256("doc-b");

    function setUp() public {
        reg = new DiplomaRegistry();
        reg.onboardIssuerAndUniversity(issuer1, 1001, "Politechnika Warszawska", "PL", "https://pw.edu.pl", "PKA-001");
        reg.onboardIssuerAndUniversity(issuer2, 1002, "Uniwersytet Jagiellonski", "PL", "https://uj.edu.pl", "PKA-002");
    }

    function testIssueBatchAndVerifyWithProof() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Valid));
        assertTrue(reg.verifyBatchMembership(docA, issuer1, batchId, proofA));
        assertEq(reg.getBatch(issuer1, batchId), root);
    }

    function testRevokeFromBatch() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        vm.prank(issuer1);
        reg.revokeFromBatch(docA, batchId, proofA);

        assertTrue(reg.isRevoked(docA, issuer1, batchId));
        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Revoked));
    }

    function testRevokeFromBatchRejectsInvalidProof() public {
        (bytes32 root,,) = _buildTwoLeafTree();
        bytes32[] memory badProof = new bytes32[](1);
        badProof[0] = keccak256("wrong");

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.InvalidProof.selector);
        reg.revokeFromBatch(docA, batchId, badProof);
    }

    function testRevokeFromBatchRejectsNonBatchIssuer() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        vm.prank(issuer2);
        vm.expectRevert(DiplomaRegistry.NotIssuerOfBatch.selector);
        reg.revokeFromBatch(docA, batchId, proofA);
    }

    function testIssueBatchRootOnlyIssuer() public {
        vm.prank(outsider);
        vm.expectRevert(DiplomaRegistry.OnlyIssuer.selector);
        reg.issueBatchRoot(batchId, keccak256("root"));
    }

    function testIssueBatchRootBadRoot() public {
        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.BadRoot.selector);
        reg.issueBatchRoot(batchId, bytes32(0));
    }

    function testOnboardRejectsZeroUniversityId() public {
        vm.expectRevert(DiplomaRegistry.BadUniversityId.selector);
        reg.onboardIssuerAndUniversity(address(0xD00D), 0, "name", "", "", "");
    }

    function testOnboardRejectsZeroIssuer() public {
        vm.expectRevert(DiplomaRegistry.BadIssuer.selector);
        reg.onboardIssuerAndUniversity(address(0), 2001, "name", "", "", "");
    }

    function testOnboardRejectsBadName() public {
        vm.expectRevert(DiplomaRegistry.BadName.selector);
        reg.onboardIssuerAndUniversity(address(0xD00D), 2001, "", "", "", "");
    }

    function testOnboardRejectsNoop() public {
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.onboardIssuerAndUniversity(issuer1, 1001, "Politechnika Warszawska", "PL", "https://pw.edu.pl", "PKA-001");
    }

    function testSetUniversityUpdatesStatus() public {
        reg.setUniversity(1001, DiplomaRegistry.UniversityStatus.Suspended, "Politechnika Warszawska", "PL", "", "");
        assertEq(uint256(reg.getUniversityStatus(1001)), uint256(DiplomaRegistry.UniversityStatus.Suspended));
    }

    function testSetUniversityEmitsEvent() public {
        vm.expectEmit(true, true, false, true);
        emit UniversitySet(1001, DiplomaRegistry.UniversityStatus.Suspended, "New Name", "PL", "", "");
        reg.setUniversity(1001, DiplomaRegistry.UniversityStatus.Suspended, "New Name", "PL", "", "");
    }

    function testRemoveIssuerRejectsNoop() public {
        reg.removeIssuer(issuer1);
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.removeIssuer(issuer1);
    }

    function testOnboardIssuerAndUniversityUpdatesAllInOneTx() public {
        address newIssuer = address(0xD00D);
        reg.onboardIssuerAndUniversity(newIssuer, 3001, "Nowa Uczelnia", "PL", "", "");

        assertEq(uint256(reg.getUniversityStatus(3001)), uint256(DiplomaRegistry.UniversityStatus.Active));
        assertEq(reg.issuerUniversityId(newIssuer), uint64(3001));
    }

    function testOnboardIssuerAndUniversityRejectsNoop() public {
        reg.onboardIssuerAndUniversity(address(0xF001), 4001, "Uczelnia 4001", "", "", "");
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.onboardIssuerAndUniversity(address(0xF001), 4001, "Uczelnia 4001", "", "", "");
    }

    function testIssueBatchRootBlockedWhenUniversitySuspended() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        reg.setUniversity(1001, DiplomaRegistry.UniversityStatus.Suspended, "Politechnika Warszawska", "PL", "", "");

        // statusWithProof now always checks university status
        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Unknown));

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.UniversityNotActive.selector);
        reg.issueBatchRoot(batchId + 1, keccak256("root2"));
    }

    function testStatusWithProofUnknownAfterIssuerRemoved() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        reg.removeIssuer(issuer1);

        // statusWithProof checks current issuer trust — Unknown after removal
        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Unknown));
    }

    function testIssueBatchRootDuplicateBatchIdSameIssuer() public {
        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, keccak256("root"));

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.BatchAlreadyIssued.selector);
        reg.issueBatchRoot(batchId, keccak256("root2"));
    }

    function testIssueBatchRootSameBatchIdDifferentIssuersAllowed() public {
        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, keccak256("root1"));
        vm.prank(issuer2);
        reg.issueBatchRoot(batchId, keccak256("root2"));

        assertEq(reg.getBatch(issuer1, batchId), keccak256("root1"));
        assertEq(reg.getBatch(issuer2, batchId), keccak256("root2"));
    }

    function testRevokeIsolationSameDocHashAcrossIssuers() public {
        bytes32[] memory emptyProof = new bytes32[](0);
        bytes32 root1 = reg.merkleLeaf(docA, batchId, issuer1);
        bytes32 root2 = reg.merkleLeaf(docA, batchId, issuer2);

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root1);
        vm.prank(issuer2);
        reg.issueBatchRoot(batchId, root2);
        vm.prank(issuer1);
        reg.revokeFromBatch(docA, batchId, emptyProof);

        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, emptyProof)), uint256(DiplomaRegistry.Status.Revoked));
        assertEq(uint256(reg.statusWithProof(docA, issuer2, batchId, emptyProof)), uint256(DiplomaRegistry.Status.Valid));
    }

    function testMerkleLeafDependsOnIssuer() public view {
        assertTrue(reg.merkleLeaf(docA, batchId, issuer1) != reg.merkleLeaf(docA, batchId, issuer2));
    }

    function testGetUniversityStatus() public view {
        assertEq(uint256(reg.getUniversityStatus(1001)), uint256(DiplomaRegistry.UniversityStatus.Active));
        assertEq(uint256(reg.getUniversityStatus(9999)), uint256(DiplomaRegistry.UniversityStatus.Unknown));
    }

    // ── Deep-proof integration tests ───────────────────────────────────────

    function testStatusWithProof_Depth4() public {
        (bytes32 root, bytes32[] memory leaves, bytes32[][] memory levels) = _buildBalancedTree(16);

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        // Verify leaf 0 (first diploma)
        bytes32[] memory proof = _getProof(levels, 0);
        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        assertEq(
            uint256(reg.statusWithProof(doc0, issuer1, batchId, proof)),
            uint256(DiplomaRegistry.Status.Valid)
        );
        assertTrue(reg.verifyBatchMembership(doc0, issuer1, batchId, proof));

        // Verify leaf 15 (last diploma)
        bytes32[] memory proof15 = _getProof(levels, 15);
        bytes32 doc15 = keccak256(abi.encodePacked("doc", uint256(15)));
        assertEq(
            uint256(reg.statusWithProof(doc15, issuer1, batchId, proof15)),
            uint256(DiplomaRegistry.Status.Valid)
        );

        // leaves array is built but only referenced through levels
        assertEq(leaves.length, 16);
    }

    function testStatusWithProof_Depth8() public {
        (bytes32 root, bytes32[] memory leaves, bytes32[][] memory levels) = _buildBalancedTree(256);

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        bytes32[] memory proof = _getProof(levels, 0);
        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        assertEq(
            uint256(reg.statusWithProof(doc0, issuer1, batchId, proof)),
            uint256(DiplomaRegistry.Status.Valid)
        );
        assertEq(proof.length, 8);
        assertEq(leaves.length, 256);
    }

    function testRevokeFromBatch_Depth4() public {
        (bytes32 root,, bytes32[][] memory levels) = _buildBalancedTree(16);

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory proof = _getProof(levels, 0);

        vm.prank(issuer1);
        reg.revokeFromBatch(doc0, batchId, proof);

        assertTrue(reg.isRevoked(doc0, issuer1, batchId));
        assertEq(
            uint256(reg.statusWithProof(doc0, issuer1, batchId, proof)),
            uint256(DiplomaRegistry.Status.Revoked)
        );

        // Other diplomas in the same batch remain valid
        bytes32 doc1 = keccak256(abi.encodePacked("doc", uint256(1)));
        bytes32[] memory proof1 = _getProof(levels, 1);
        assertEq(
            uint256(reg.statusWithProof(doc1, issuer1, batchId, proof1)),
            uint256(DiplomaRegistry.Status.Valid)
        );
    }

    function testInvalidProof_Depth4() public {
        (bytes32 root,, bytes32[][] memory levels) = _buildBalancedTree(16);

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        bytes32 doc0 = keccak256(abi.encodePacked("doc", uint256(0)));
        bytes32[] memory goodProof = _getProof(levels, 0);

        // Corrupt one element
        goodProof[2] = keccak256("garbage");

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.InvalidProof.selector);
        reg.revokeFromBatch(doc0, batchId, goodProof);
    }

    // ── Tree helpers ───────────────────────────────────────────────────────

    /// @dev Build a balanced Merkle tree with `n` leaves (n must be a power of 2).
    ///      Returns the root, the leaf array, and all levels (level[0] = leaves).
    function _buildBalancedTree(uint256 n)
        internal
        view
        returns (bytes32 root, bytes32[] memory leaves, bytes32[][] memory levels)
    {
        // Compute depth
        uint256 depth = 0;
        { uint256 tmp = n; while (tmp > 1) { depth++; tmp >>= 1; } }

        levels = new bytes32[][](depth + 1);

        // Level 0: compute leaves
        leaves = new bytes32[](n);
        for (uint256 i = 0; i < n; i++) {
            bytes32 doc = keccak256(abi.encodePacked("doc", i));
            leaves[i] = reg.merkleLeaf(doc, batchId, issuer1);
        }
        levels[0] = leaves;

        // Build up the tree
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

    /// @dev Return the Merkle proof for leaf at `leafIndex` given the full level array.
    function _getProof(bytes32[][] memory levels, uint256 leafIndex)
        internal
        pure
        returns (bytes32[] memory proof)
    {
        uint256 depth = levels.length - 1;
        proof = new bytes32[](depth);
        uint256 idx = leafIndex;
        for (uint256 d = 0; d < depth; d++) {
            uint256 sibling = (idx % 2 == 0) ? idx + 1 : idx - 1;
            proof[d] = levels[d][sibling];
            idx /= 2;
        }
    }

    function _buildTwoLeafTree() internal view returns (bytes32 root, bytes32 leafA, bytes32 leafB) {
        leafA = reg.merkleLeaf(docA, batchId, issuer1);
        leafB = reg.merkleLeaf(docB, batchId, issuer1);
        root = leafA < leafB
            ? keccak256(abi.encodePacked(leafA, leafB))
            : keccak256(abi.encodePacked(leafB, leafA));
    }

    // ── Ownable2Step tests ──────────────────────────────────────────────────

    function testTransferOwnershipStartsPending() public {
        address newOwner = address(0xAE01);
        reg.transferOwnership(newOwner);
        assertEq(reg.pendingOwner(), newOwner);
        assertEq(reg.owner(), address(this)); // still old owner
    }

    function testAcceptOwnershipCompletes() public {
        address newOwner = address(0xAE01);
        reg.transferOwnership(newOwner);

        vm.prank(newOwner);
        reg.acceptOwnership();

        assertEq(reg.owner(), newOwner);
        assertEq(reg.pendingOwner(), address(0));
    }

    function testAcceptOwnershipRevertsIfNotPending() public {
        reg.transferOwnership(address(0xAE01));

        vm.prank(outsider);
        vm.expectRevert(DiplomaRegistry.OnlyPendingOwner.selector);
        reg.acceptOwnership();
    }

    function testTransferOwnershipRevertsIfNotOwner() public {
        vm.prank(outsider);
        vm.expectRevert(DiplomaRegistry.OnlyOwner.selector);
        reg.transferOwnership(address(0xAE01));
    }

    function testTransferOwnershipRevertsZeroAddress() public {
        vm.expectRevert(DiplomaRegistry.NewOwnerIsZero.selector);
        reg.transferOwnership(address(0));
    }

    function testNewOwnerCanUseOnlyOwnerFunctions() public {
        address newOwner = address(0xAE01);
        reg.transferOwnership(newOwner);
        vm.prank(newOwner);
        reg.acceptOwnership();

        // Old owner can no longer call onlyOwner functions
        vm.expectRevert(DiplomaRegistry.OnlyOwner.selector);
        reg.removeIssuer(issuer1);

        // New owner can
        vm.prank(newOwner);
        reg.removeIssuer(issuer1);
    }
}
