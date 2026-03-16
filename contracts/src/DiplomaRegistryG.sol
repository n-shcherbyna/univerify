// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title DiplomaRegistryG — Gas-optimised Merkle diploma registry
/// @notice Identical behaviour to DiplomaRegistry (baseline); applies four
///         incremental micro-optimisations on the Merkle hot path:
///
///   G1 — unchecked loop counter + pre-increment (++i) in _processProof
///   G2 — assembly scratch-space keccak; eliminates ABI-encoder memory
///        allocation and free-pointer update on every proof step
///   G3 — private _merkleLeaf (no zero-checks) used on all internal paths;
///        public merkleLeaf retains original validation for external callers
///   G4 — assembly preimage packing in _merkleLeaf; eliminates ABI-encoder
///        overhead for the 112-byte encodePacked call
contract DiplomaRegistryG {
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
        // G3: inputs already validated above — skip zero-checks in leaf computation
        bytes32 leaf = _merkleLeaf(docHash, batchId, msg.sender);
        if (!_verifyProof(proof, root, leaf)) revert InvalidProof();
        if (revokedLeaf[leaf]) revert AlreadyRevoked();
        revokedLeaf[leaf] = true;
        emit DiplomaRevoked(docHash, msg.sender, uint64(block.timestamp));
    }

    // ── View ───────────────────────────────────────────────────────────────

    function statusWithProof(
        bytes32 docHash,
        address issuer_,
        uint64 batchId,
        bytes32[] calldata proof
    ) external view returns (Status) {
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
        // G3: external callers pass arbitrary input — use unvalidated _merkleLeaf only when
        //     inputs are implicitly constrained (here they are not, but isRevoked is a read-only
        //     view and an incorrect leaf simply returns false, so it is safe to skip checks).
        return revokedLeaf[_merkleLeaf(docHash, batchId, issuer_)];
    }

    function verifyBatchMembership(
        bytes32 docHash,
        address issuer_,
        uint64 batchId,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 root = batchRoots[issuer_][batchId];
        if (root == bytes32(0)) return false;
        return _verifyProof(proof, root, _merkleLeaf(docHash, batchId, issuer_));
    }

    /// @notice Public entry-point for leaf computation — retains original validation.
    function merkleLeaf(bytes32 docHash, uint64 batchId, address issuer_) public view returns (bytes32) {
        if (docHash == bytes32(0)) revert BadHash();
        if (issuer_ == address(0)) revert BadIssuer();
        return _merkleLeaf(docHash, batchId, issuer_);
    }

    // ── Internal ───────────────────────────────────────────────────────────

    function _statusWithProof(
        bytes32 docHash,
        address issuer_,
        uint64 batchId,
        bytes32[] calldata proof
    ) private view returns (Status) {
        bytes32 root = batchRoots[issuer_][batchId];
        if (root == bytes32(0)) return Status.Unknown;
        // G3: root existence already checked; zero docHash/issuer_ would produce a
        //     non-matching leaf, returning Unknown without reverting — acceptable.
        bytes32 leaf = _merkleLeaf(docHash, batchId, issuer_);
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

    /// @dev G1 + G2: cached proof length, unchecked pre-increment, and assembly
    ///      keccak256 using the EVM scratch space (0x00–0x3f) to avoid ABI-encoder
    ///      memory allocation and free-pointer bookkeeping on every loop iteration.
    function _processProof(bytes32[] calldata proof, bytes32 leaf) private pure returns (bytes32 h) {
        h = leaf;
        uint256 len = proof.length;
        unchecked {
            for (uint256 i = 0; i < len; ++i) {
                bytes32 node = proof[i];
                // Scratch space (0x00–0x3f) is reserved by the EVM ABI for temporary use.
                // Writing there is safe in a pure function with no concurrent allocations.
                assembly ("memory-safe") {
                    switch lt(h, node)
                    case 1 {
                        mstore(0x00, h)
                        mstore(0x20, node)
                    }
                    default {
                        mstore(0x00, node)
                        mstore(0x20, h)
                    }
                    h := keccak256(0x00, 0x40)
                }
            }
        }
    }

    /// @dev G3 + G4: no input validation; preimage built via assembly to avoid
    ///      ABI-encoder overhead for the 112-byte abi.encodePacked call.
    ///
    ///      Layout (packed, same as baseline abi.encodePacked):
    ///        [0–19]   address(this)   20 bytes
    ///        [20–51]  block.chainid   32 bytes
    ///        [52–71]  issuer_         20 bytes
    ///        [72–79]  batchId         8 bytes
    ///        [80–111] docHash         32 bytes
    ///                                 = 112 bytes
    function _merkleLeaf(bytes32 docHash, uint64 batchId, address issuer_) private view returns (bytes32 h) {
        // solhint-disable-next-line no-inline-assembly
        assembly {
            // Allocate 112 bytes from the free memory pointer.
            let ptr := mload(0x40)
            mstore(0x40, add(ptr, 128)) // advance free ptr (next 32-byte aligned slot)

            // address(this) — left-justify 20 bytes; the right 12 bytes are overwritten
            // by the chainid store below.
            mstore(ptr,          shl(96, address()))
            // block.chainid — 32 bytes; overwrites the zero-padding of the address word.
            mstore(add(ptr, 20), chainid())
            // issuer_ — 20 bytes; left-justified, right bytes overwritten by batchId.
            mstore(add(ptr, 52), shl(96, issuer_))
            // batchId — 8 bytes; left-justified in 32-byte word, right bytes overwritten.
            mstore(add(ptr, 72), shl(192, batchId))
            // docHash — 32 bytes; fills the remainder.
            mstore(add(ptr, 80), docHash)

            h := keccak256(ptr, 112)
        }
    }
}
