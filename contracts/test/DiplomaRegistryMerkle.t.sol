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

    bytes32 constant UNI_1001_NAME = bytes32("Politechnika Warszawska");
    bytes32 constant UNI_1002_NAME = bytes32("Uniwersytet Jagiellonski");

    function setUp() public {
        reg = new DiplomaRegistry();
        reg.onboardIssuerAndUniversity(issuer1, 1001, UNI_1001_NAME);
        reg.onboardIssuerAndUniversity(issuer2, 1002, UNI_1002_NAME);
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
        reg.onboardIssuerAndUniversity(address(0xD00D), 0, bytes32("name"));
    }

    function testOnboardRejectsZeroIssuer() public {
        vm.expectRevert(DiplomaRegistry.BadIssuer.selector);
        reg.onboardIssuerAndUniversity(address(0), 2001, bytes32("name"));
    }

    function testOnboardRejectsBadName() public {
        vm.expectRevert(DiplomaRegistry.BadName.selector);
        reg.onboardIssuerAndUniversity(address(0xD00D), 2001, bytes32(0));
    }

    function testOnboardRejectsNoop() public {
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.onboardIssuerAndUniversity(issuer1, 1001, UNI_1001_NAME);
    }

    function testSetUniversityRejectsNoop() public {
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.setUniversity(1001, UNI_1001_NAME, DiplomaRegistry.UniversityStatus.Active);
    }

    function testSetUniversityUpdatesNameAndStatus() public {
        bytes32 newName = bytes32("Politechnika v2");
        reg.setUniversity(1001, newName, DiplomaRegistry.UniversityStatus.Suspended);

        (bytes32 onChainName, DiplomaRegistry.UniversityStatus st) = reg.getUniversity(1001);
        assertEq(onChainName, newName);
        assertEq(uint256(st), uint256(DiplomaRegistry.UniversityStatus.Suspended));
    }

    function testRemoveIssuerRejectsNoop() public {
        reg.removeIssuer(issuer1);
        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.removeIssuer(issuer1);
    }

    function testOnboardIssuerAndUniversityUpdatesAllInOneTx() public {
        address newIssuer = address(0xD00D);
        uint64 universityId = 3001;
        bytes32 name = bytes32("Nowa Uczelnia");

        reg.onboardIssuerAndUniversity(newIssuer, universityId, name);

        (bytes32 onChainName, DiplomaRegistry.UniversityStatus st) = reg.getUniversity(universityId);
        assertEq(onChainName, name);
        assertEq(uint256(st), uint256(DiplomaRegistry.UniversityStatus.Active));
        assertEq(reg.issuerUniversityId(newIssuer), universityId);
    }

    function testOnboardIssuerAndUniversityRejectsNoop() public {
        address issuer = address(0xF001);
        bytes32 name = bytes32("Uczelnia 4001");
        reg.onboardIssuerAndUniversity(issuer, 4001, name);

        vm.expectRevert(DiplomaRegistry.NoChange.selector);
        reg.onboardIssuerAndUniversity(issuer, 4001, name);
    }

    function testIssueBatchRootBlockedWhenUniversitySuspended() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        reg.setUniversity(1001, bytes32("Politechnika v2"), DiplomaRegistry.UniversityStatus.Suspended);

        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Valid));
        assertEq(uint256(reg.statusWithProofTrusted(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Unknown));

        vm.prank(issuer1);
        vm.expectRevert(DiplomaRegistry.UniversityNotActive.selector);
        reg.issueBatchRoot(batchId + 1, keccak256("root2"));
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
        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, keccak256("root"));

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

    function testGetUniversityReturnsName() public view {
        (bytes32 name, DiplomaRegistry.UniversityStatus st) = reg.getUniversity(1001);
        assertEq(name, UNI_1001_NAME);
        assertEq(uint256(st), uint256(DiplomaRegistry.UniversityStatus.Active));
    }

    function _buildTwoLeafTree() internal view returns (bytes32 root, bytes32 leafA, bytes32 leafB) {
        leafA = reg.merkleLeaf(docA, batchId, issuer1);
        leafB = reg.merkleLeaf(docB, batchId, issuer1);
        root = leafA < leafB
            ? keccak256(abi.encodePacked(leafA, leafB))
            : keccak256(abi.encodePacked(leafB, leafA));
    }
}
