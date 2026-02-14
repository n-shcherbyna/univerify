// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DiplomaRegistry {
    enum Status { Unknown, Valid, Revoked }

    error OnlyOwner();
    error OnlyIssuer();
    error BadIssuer();
    error BadHash();
    error BadRoot();
    error BatchAlreadyIssued();
    error NotIssuerOfBatch();
    error AlreadyRevoked();
    error InvalidProof();

    address public immutable owner;

    mapping(address => bool) public isIssuer;
    mapping(bytes32 => bool) private revokedLeaf;
    mapping(address => mapping(uint64 => bytes32)) private batchRoots;

    event IssuerAdded(address issuer);
    event IssuerRemoved(address issuer);

    event DiplomaRevoked(bytes32 indexed docHash, address indexed issuer, uint64 revokedAt);
    event BatchIssued(uint64 indexed batchId, bytes32 indexed merkleRoot, address indexed issuer);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyIssuer() {
        if (!isIssuer[msg.sender]) revert OnlyIssuer();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) revert BadIssuer();
        isIssuer[issuer] = true;
        emit IssuerAdded(issuer);
    }

    function removeIssuer(address issuer) external onlyOwner {
        isIssuer[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    function issueBatchRoot(uint64 batchId, bytes32 merkleRoot) external onlyIssuer {
        if (merkleRoot == bytes32(0)) revert BadRoot();
        if (batchRoots[msg.sender][batchId] != bytes32(0)) revert BatchAlreadyIssued();
        batchRoots[msg.sender][batchId] = merkleRoot;

        emit BatchIssued(batchId, merkleRoot, msg.sender);
    }

    function revokeFromBatch(bytes32 docHash, uint64 batchId, bytes32[] calldata proof) external onlyIssuer {
        if (docHash == bytes32(0)) revert BadHash();

        bytes32 root = batchRoots[msg.sender][batchId];
        if (root == bytes32(0)) revert NotIssuerOfBatch();

        bytes32 leaf = merkleLeaf(docHash, batchId, msg.sender);
        if (!_verifyProof(proof, root, leaf)) revert InvalidProof();

        if (revokedLeaf[leaf]) revert AlreadyRevoked();
        revokedLeaf[leaf] = true;
        emit DiplomaRevoked(docHash, msg.sender, uint64(block.timestamp));
    }

    function statusWithProof(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) external view returns (Status) {
        bytes32 root = batchRoots[issuer_][batchId];
        if (root == bytes32(0)) return Status.Unknown;

        bytes32 leaf = merkleLeaf(docHash, batchId, issuer_);
        if (revokedLeaf[leaf]) return Status.Revoked;
        if (!_verifyProof(proof, root, leaf)) return Status.Unknown;

        return Status.Valid;
    }

    function verifyBatchMembership(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) external view returns (bool) {
        bytes32 root = batchRoots[issuer_][batchId];
        if (root == bytes32(0)) return false;
        bytes32 leaf = merkleLeaf(docHash, batchId, issuer_);
        return _verifyProof(proof, root, leaf);
    }

    function getBatch(address issuer_, uint64 batchId) external view returns (bytes32 merkleRoot) {
        return batchRoots[issuer_][batchId];
    }

    function isRevoked(bytes32 docHash, address issuer_, uint64 batchId) external view returns (bool) {
        return revokedLeaf[merkleLeaf(docHash, batchId, issuer_)];
    }

    function merkleLeaf(bytes32 docHash, uint64 batchId, address issuer_) public view returns (bytes32) {
        if (docHash == bytes32(0)) revert BadHash();
        if (issuer_ == address(0)) revert BadIssuer();
        return keccak256(abi.encodePacked(address(this), block.chainid, issuer_, batchId, docHash));
    }

    function _verifyProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) private pure returns (bool) {
        return _processProof(proof, leaf) == root;
    }

    function _processProof(bytes32[] calldata proof, bytes32 leaf) private pure returns (bytes32 computedHash) {
        computedHash = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            computedHash = _hashPair(computedHash, proof[i]);
        }
    }

    function _hashPair(bytes32 a, bytes32 b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encodePacked(a, b)) : keccak256(abi.encodePacked(b, a));
    }
}
