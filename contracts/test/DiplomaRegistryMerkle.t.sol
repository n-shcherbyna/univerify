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
        reg.addIssuer(issuer1, 1001);
        reg.addIssuer(issuer2, 1002);
    }

    function testIssueBatchAndVerifyWithProof() public {
        (bytes32 root,, bytes32 leafB) = _buildTwoLeafTree();
        bytes32[] memory proofA = new bytes32[](1);
        proofA[0] = leafB;

        vm.prank(issuer1);
        reg.issueBatchRoot(batchId, root);

        assertEq(uint256(reg.statusWithProof(docA, issuer1, batchId, proofA)), uint256(DiplomaRegistry.Status.Valid));
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

    function testAddIssuerRejectsZeroUniversityId() public {
        vm.expectRevert(DiplomaRegistry.BadUniversityId.selector);
        reg.addIssuer(address(0xD00D), 0);
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
