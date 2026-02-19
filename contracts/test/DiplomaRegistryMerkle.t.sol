// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import {DiplomaRegistry} from "../src/DiplomaRegistry.sol";

contract DiplomaRegistryMerkleTest is Test {
    DiplomaRegistry reg;

    address issuer1 = address(0xB0B);
    address issuer2 = address(0xB0B2);
    address outsider = address(0xCAFE);

    uint64 batchId = 1;
    bytes32 docA = keccak256("doc-a");
    bytes32 docB = keccak256("doc-b");

    function setUp() public {
        reg = new DiplomaRegistry();
        reg.onboardIssuerAndUniversity(issuer1, 1001, keccak256("uni-1001"), keccak256("snapshot-setup-1"));
        reg.onboardIssuerAndUniversity(issuer2, 1002, keccak256("uni-1002"), keccak256("snapshot-setup-2"));
    }

    function testIssueBatchAndVerifyWithProof() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Valid));
        assertEq(uint256(reg.statusWithProofTrusted(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Valid));
        assertTrue(reg.verifyBatchMembership(docA, issuer1, batchId, proofA));

        bytes32 onChainRoot = reg.getBatch(issuer1, batchId);
        assertEq(onChainRoot, root);
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
        reg.onboardIssuerAndUniversity(address(0xD00D), 0, keccak256("meta"), keccak256("snap"));
    }

    function testOnboardRejectsZeroIssuer() public {
        vm.expectRevert(DiplomaRegistry.BadIssuer.selector);
        reg.onboardIssuerAndUniversity(address(0), 2001, keccak256("meta"), keccak256("snap"));
    }

    function testOnboardRejectsNoop() public {
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.onboardIssuerAndUniversity(issuer1, 1001, keccak256("uni-1001"), keccak256("snapshot-setup-2"));
    }

    function testSetUniversityRejectsNoop() public {
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.setUniversity(1001, keccak256("uni-1001"), DiplomaRegistry.UniversityStatus.Active);
    }

    function testSetUniversityAndSnapshotUpdatesBoth() public {
        uint64 universityId = 1001;
        bytes32 nextMeta = keccak256("uni-1001-v3");
        bytes32 nextSnap = keccak256("snapshot-v3");

        reg.setUniversityAndSnapshot(universityId, nextMeta, DiplomaRegistry.UniversityStatus.Suspended, nextSnap);

        (bytes32 onChainMeta, DiplomaRegistry.UniversityStatus st) = reg.getUniversity(universityId);
        assertEq(onChainMeta, nextMeta);
        assertEq(uint256(st), uint256(DiplomaRegistry.UniversityStatus.Suspended));
        assertEq(reg.snapshotHash(), nextSnap);
    }

    function testSetUniversityAndSnapshotRejectsNoop() public {
        bytes32 snap = reg.snapshotHash();
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.setUniversityAndSnapshot(1001, keccak256("uni-1001"), DiplomaRegistry.UniversityStatus.Active, snap);
    }

    function testOnboardRejectsBadSnapshot() public {
        vm.expectRevert(DiplomaRegistry.BadSnapshot.selector);
        reg.onboardIssuerAndUniversity(address(0xD00D), 2001, keccak256("meta"), bytes32(0));
    }

    function testOnboardRejectsBadHash() public {
        vm.expectRevert(DiplomaRegistry.BadHash.selector);
        reg.onboardIssuerAndUniversity(address(0xD00D), 2001, bytes32(0), keccak256("snap"));
    }

    function testRemoveIssuerRejectsNoop() public {
        vm.prank(address(reg.owner()));
        reg.removeIssuer(issuer1);

        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.removeIssuer(issuer1);
    }

    function testOnboardIssuerAndUniversityUpdatesAllInOneTx() public {
        address newIssuer = address(0xD00D);
        uint64 universityId = 3001;
        bytes32 metadataHash = keccak256("uni-3001");
        bytes32 snap = keccak256("snapshot-3001");

        reg.onboardIssuerAndUniversity(newIssuer, universityId, metadataHash, snap);

        (bytes32 onChainMetadataHash, DiplomaRegistry.UniversityStatus st) = reg.getUniversity(universityId);
        assertEq(onChainMetadataHash, metadataHash);
        assertEq(uint256(st), uint256(DiplomaRegistry.UniversityStatus.Active));
        assertEq(reg.issuerUniversityId(newIssuer), universityId);
        assertEq(reg.snapshotHash(), snap);
    }

    function testOnboardIssuerAndUniversityRejectsNoop() public {
        uint64 universityId = 4001;
        address issuer = address(0xF001);
        bytes32 metadataHash = keccak256("uni-4001");
        bytes32 snap = keccak256("snapshot-same");

        reg.onboardIssuerAndUniversity(issuer, universityId, metadataHash, snap);

        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.onboardIssuerAndUniversity(issuer, universityId, metadataHash, snap);
    }

    function testIssueBatchRootBlockedWhenUniversitySuspended() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        reg.setUniversity(1001, keccak256("uni-1001-v2"), DiplomaRegistry.UniversityStatus.Suspended);

        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Valid));
        assertEq(uint256(reg.statusWithProofTrusted(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Unknown));

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.UniversityNotActive.selector);
        reg.issueBatchRoot(batchId, keccak256("root"));
    }

    function testStatusWithProofTrustedUnknownAfterIssuerRemoved() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        reg.removeIssuer(issuer1);

        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Valid));
        assertEq(uint256(reg.statusWithProofTrusted(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Unknown));
    }

    function testIssueBatchRootDuplicateBatchIdSameIssuer() public {
        bytes32 root = keccak256("root");

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.BatchAlreadyIssued.selector);
        reg.issueBatchRoot(batchId, keccak256("root2"));
    }

    function testIssueBatchRootSameBatchIdDifferentIssuersAllowed() public {
        bytes32 root1 = keccak256("root1");
        bytes32 root2 = keccak256("root2");

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root1);

        vm.prank(issuer2);
        reg.issueBatchRoot(batchId, root2);

        assertEq(reg.getBatch(issuer1, batchId), root1);
        assertEq(reg.getBatch(issuer2, batchId), root2);
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
        bytes32 a = reg.merkleLeaf(docA, batchId, issuer1);
        bytes32 b = reg.merkleLeaf(docA, batchId, issuer2);
        assertTrue(a != b);
    }

    function _buildTwoLeafTree() internal view returns (bytes32 root, bytes32 leafA, bytes32 leafB) {
        leafA = reg.merkleLeaf(docA, batchId, issuer1);
        leafB = reg.merkleLeaf(docB, batchId, issuer1);
        root = _hashPair(leafA, leafB);
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
