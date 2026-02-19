// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DiplomaRegistry {
    enum Status { Unknown, Valid, Revoked }
    enum UniversityStatus { Unknown, Active, Suspended, Revoked }

    error OnlyOwner();
    error OnlyIssuer();
    error NoChange();
    error BadIssuer();
    error BadUniversityId();
    error BadUniversityStatus();
    error BadSnapshot();
    error UniversityNotActive();
    error BadHash();
    error BadRoot();
    error BatchAlreadyIssued();
    error NotIssuerOfBatch();
    error AlreadyRevoked();
    error InvalidProof();

    address public immutable owner;

    struct University {
        bytes32 metadataHash;
        UniversityStatus status;
    }

    mapping(address => uint64) private issuerUniversityIds;
    mapping(uint64 => University) private universities;
    mapping(bytes32 => bool) private revokedLeaf;
    mapping(address => mapping(uint64 => bytes32)) private batchRoots;

    bytes32 public snapshotHash;

    event IssuerAdded(address issuer);
    event IssuerRemoved(address issuer);
    event UniversitySet(uint64 indexed universityId, bytes32 indexed metadataHash, UniversityStatus status);
    event SnapshotUpdated(bytes32 indexed snapshotHash);

    event DiplomaRevoked(bytes32 indexed docHash, address indexed issuer, uint64 revokedAt);
    event BatchIssued(uint64 indexed batchId, bytes32 indexed merkleRoot, address indexed issuer);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setUniversity(uint64 universityId, bytes32 metadataHash, UniversityStatus status) external onlyOwner {
        if (universityId == 0) revert BadUniversityId();
        if (metadataHash == bytes32(0)) revert BadHash();
        if (status == UniversityStatus.Unknown) revert BadUniversityStatus();
        University storage current = universities[universityId];
        if (current.metadataHash == metadataHash && current.status == status) revert NoChange();
        universities[universityId] = University({ metadataHash: metadataHash, status: status });
        emit UniversitySet(universityId, metadataHash, status);
    }

    function setUniversityAndSnapshot(
        uint64 universityId,
        bytes32 metadataHash,
        UniversityStatus status,
        bytes32 snapshotHash_
    ) external onlyOwner {
        if (universityId == 0) revert BadUniversityId();
        if (metadataHash == bytes32(0)) revert BadHash();
        if (status == UniversityStatus.Unknown) revert BadUniversityStatus();
        if (snapshotHash_ == bytes32(0)) revert BadSnapshot();

        University storage current = universities[universityId];
        bool universityChanged = (current.metadataHash != metadataHash) || (current.status != status);
        bool snapshotChanged = snapshotHash != snapshotHash_;
        if (!universityChanged && !snapshotChanged) revert NoChange();

        if (universityChanged) {
            universities[universityId] = University({ metadataHash: metadataHash, status: status });
            emit UniversitySet(universityId, metadataHash, status);
        }

        if (snapshotChanged) {
            snapshotHash = snapshotHash_;
            emit SnapshotUpdated(snapshotHash_);
        }
    }

    function onboardIssuerAndUniversity(
        address issuer,
        uint64 universityId,
        bytes32 metadataHash,
        bytes32 snapshotHash_
    ) external onlyOwner {
        if (issuer == address(0)) revert BadIssuer();
        if (universityId == 0) revert BadUniversityId();
        if (metadataHash == bytes32(0)) revert BadHash();
        if (snapshotHash_ == bytes32(0)) revert BadSnapshot();

        University storage u = universities[universityId];
        bool universityChanged = (u.metadataHash != metadataHash) || (u.status != UniversityStatus.Active);
        bool issuerChanged = issuerUniversityIds[issuer] != universityId;
        bool snapshotChanged = snapshotHash != snapshotHash_;

        if (!universityChanged && !issuerChanged && !snapshotChanged) revert NoChange();

        if (universityChanged) {
            universities[universityId] = University({ metadataHash: metadataHash, status: UniversityStatus.Active });
            emit UniversitySet(universityId, metadataHash, UniversityStatus.Active);
        }

        if (issuerChanged) {
            issuerUniversityIds[issuer] = universityId;
            emit IssuerAdded(issuer);
        }

        if (snapshotChanged) {
            snapshotHash = snapshotHash_;
            emit SnapshotUpdated(snapshotHash_);
        }
    }

    function removeIssuer(address issuer) external onlyOwner {
        if (issuerUniversityIds[issuer] == 0) revert NoChange();
        issuerUniversityIds[issuer] = 0;
        emit IssuerRemoved(issuer);
    }

    function isIssuer(address issuer) external view returns (bool) {
        uint64 universityId = issuerUniversityIds[issuer];
        return universityId != 0 && _isUniversityActive(universityId);
    }

    function issuerUniversityId(address issuer) external view returns (uint64) {
        return issuerUniversityIds[issuer];
    }

    function getUniversity(uint64 universityId) external view returns (bytes32 metadataHash, UniversityStatus status) {
        University storage u = universities[universityId];
        return (u.metadataHash, u.status);
    }

    function isUniversityActive(uint64 universityId) external view returns (bool) {
        return _isUniversityActive(universityId);
    }

    function issueBatchRoot(uint64 batchId, bytes32 merkleRoot) external {
        _requireActiveIssuer();
        if (merkleRoot == bytes32(0)) revert BadRoot();
        if (batchRoots[msg.sender][batchId] != bytes32(0)) revert BatchAlreadyIssued();
        batchRoots[msg.sender][batchId] = merkleRoot;

        emit BatchIssued(batchId, merkleRoot, msg.sender);
    }

    function revokeFromBatch(bytes32 docHash, uint64 batchId, bytes32[] calldata proof) external {
        _requireActiveIssuer();
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
        return _statusWithProof(docHash, issuer_, batchId, proof);
    }

    function statusWithProofTrusted(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) external view returns (Status) {
        Status status = _statusWithProof(docHash, issuer_, batchId, proof);
        if (status != Status.Valid) return status;

        uint64 universityId = issuerUniversityIds[issuer_];
        if (universityId == 0 || !_isUniversityActive(universityId)) return Status.Unknown;

        return Status.Valid;
    }

    function _statusWithProof(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) private view returns (Status) {
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

    function _requireActiveIssuer() private view {
        uint64 universityId = issuerUniversityIds[msg.sender];
        if (universityId == 0) revert OnlyIssuer();
        if (!_isUniversityActive(universityId)) revert UniversityNotActive();
    }

    function _isUniversityActive(uint64 universityId) private view returns (bool) {
        return universities[universityId].status == UniversityStatus.Active;
    }
}
