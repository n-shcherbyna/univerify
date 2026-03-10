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
    error BadName();
    error UniversityNotActive();
    error BadHash();
    error BadRoot();
    error BatchAlreadyIssued();
    error NotIssuerOfBatch();
    error AlreadyRevoked();
    error InvalidProof();

    address public immutable owner;

    mapping(address => uint64)  private issuerUniversityIds;
    mapping(uint64 => UniversityStatus) private universityStatus;
    mapping(bytes32 => bool)    private revokedLeaf;
    mapping(address => mapping(uint64 => bytes32)) private batchRoots;

    event IssuerAdded(address indexed issuer);
    event IssuerRemoved(address indexed issuer);
    event UniversitySet(
        uint64 indexed universityId,
        UniversityStatus indexed status,
        string name,
        string country,
        string website,
        string accreditationId
    );
    event DiplomaRevoked(bytes32 indexed docHash, address indexed issuer, uint64 revokedAt);
    event BatchIssued(uint64 indexed batchId, bytes32 indexed merkleRoot, address indexed issuer);

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    // ── Owner: universities ────────────────────────────────────────────────

    function setUniversity(
        uint64 universityId,
        UniversityStatus status,
        string calldata name,
        string calldata country,
        string calldata website,
        string calldata accreditationId
    ) external onlyOwner {
        if (universityId == 0) revert BadUniversityId();
        if (status == UniversityStatus.Unknown) revert BadUniversityStatus();
        if (bytes(name).length == 0) revert BadName();
        universityStatus[universityId] = status;
        emit UniversitySet(universityId, status, name, country, website, accreditationId);
    }

    function onboardIssuerAndUniversity(
        address issuer,
        uint64 universityId,
        string calldata name,
        string calldata country,
        string calldata website,
        string calldata accreditationId
    ) external onlyOwner {
        if (issuer == address(0)) revert BadIssuer();
        if (universityId == 0) revert BadUniversityId();
        if (bytes(name).length == 0) revert BadName();

        bool universityChanged = universityStatus[universityId] != UniversityStatus.Active;
        bool issuerChanged = issuerUniversityIds[issuer] != universityId;
        if (!universityChanged && !issuerChanged) revert NoChange();

        universityStatus[universityId] = UniversityStatus.Active;
        emit UniversitySet(universityId, UniversityStatus.Active, name, country, website, accreditationId);

        if (issuerChanged) {
            issuerUniversityIds[issuer] = universityId;
            emit IssuerAdded(issuer);
        }
    }

    function removeIssuer(address issuer) external onlyOwner {
        if (issuerUniversityIds[issuer] == 0) revert NoChange();
        issuerUniversityIds[issuer] = 0;
        emit IssuerRemoved(issuer);
    }

    // ── Issuer: batch ──────────────────────────────────────────────────────

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

    // ── View ───────────────────────────────────────────────────────────────

    function statusWithProof(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) external view returns (Status) {
        return _statusWithProof(docHash, issuer_, batchId, proof);
    }

    function statusWithProofTrusted(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) external view returns (Status) {
        Status s = _statusWithProof(docHash, issuer_, batchId, proof);
        if (s != Status.Valid) return s;
        uint64 uid = issuerUniversityIds[issuer_];
        if (uid == 0 || !_isUniversityActive(uid)) return Status.Unknown;
        return Status.Valid;
    }

    function isIssuer(address issuer) external view returns (bool) {
        uint64 uid = issuerUniversityIds[issuer];
        return uid != 0 && _isUniversityActive(uid);
    }

    function issuerUniversityId(address issuer) external view returns (uint64) {
        return issuerUniversityIds[issuer];
    }

    function getUniversityStatus(uint64 universityId) external view returns (UniversityStatus) {
        return universityStatus[universityId];
    }

    function isUniversityActive(uint64 universityId) external view returns (bool) {
        return _isUniversityActive(universityId);
    }

    function getBatch(address issuer_, uint64 batchId) external view returns (bytes32) {
        return batchRoots[issuer_][batchId];
    }

    function isRevoked(bytes32 docHash, address issuer_, uint64 batchId) external view returns (bool) {
        return revokedLeaf[merkleLeaf(docHash, batchId, issuer_)];
    }

    function verifyBatchMembership(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) external view returns (bool) {
        bytes32 root = batchRoots[issuer_][batchId];
        if (root == bytes32(0)) return false;
        return _verifyProof(proof, root, merkleLeaf(docHash, batchId, issuer_));
    }

    function merkleLeaf(bytes32 docHash, uint64 batchId, address issuer_) public view returns (bytes32) {
        if (docHash == bytes32(0)) revert BadHash();
        if (issuer_ == address(0)) revert BadIssuer();
        return keccak256(abi.encodePacked(address(this), block.chainid, issuer_, batchId, docHash));
    }

    // ── Internal ───────────────────────────────────────────────────────────

    function _statusWithProof(bytes32 docHash, address issuer_, uint64 batchId, bytes32[] calldata proof) private view returns (Status) {
        bytes32 root = batchRoots[issuer_][batchId];
        if (root == bytes32(0)) return Status.Unknown;
        bytes32 leaf = merkleLeaf(docHash, batchId, issuer_);
        if (revokedLeaf[leaf]) return Status.Revoked;
        if (!_verifyProof(proof, root, leaf)) return Status.Unknown;
        return Status.Valid;
    }

    function _requireActiveIssuer() private view {
        uint64 uid = issuerUniversityIds[msg.sender];
        if (uid == 0) revert OnlyIssuer();
        if (!_isUniversityActive(uid)) revert UniversityNotActive();
    }

    function _isUniversityActive(uint64 universityId) private view returns (bool) {
        return universityStatus[universityId] == UniversityStatus.Active;
    }

    function _verifyProof(bytes32[] calldata proof, bytes32 root, bytes32 leaf) private pure returns (bool) {
        return _processProof(proof, leaf) == root;
    }

    function _processProof(bytes32[] calldata proof, bytes32 leaf) private pure returns (bytes32 h) {
        h = leaf;
        for (uint256 i = 0; i < proof.length; i++) {
            h = h < proof[i]
                ? keccak256(abi.encodePacked(h, proof[i]))
                : keccak256(abi.encodePacked(proof[i], h));
        }
    }
}
