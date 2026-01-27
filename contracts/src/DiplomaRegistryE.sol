// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DiplomaRegistryE {
    enum Status { Unknown, Valid, Revoked }

    // 20 + 8 + 8 = 32 bytes => 1 slot
    struct Record {
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt; // 0 => not revoked
    }

    // ===== custom errors =====
    error OnlyOwner();
    error OnlyIssuer();
    error BadIssuer();
    error BadHash();
    error AlreadyIssued();
    error NotIssuerOfRecord();
    error AlreadyRevoked();

    address public immutable owner;

    mapping(address => bool) public isIssuer;
    mapping(bytes32 => Record) private records;

    event IssuerAdded(address issuer);
    event IssuerRemoved(address issuer);
    event DiplomaIssued(bytes32 indexed docHash, address indexed issuer, uint64 issuedAt);
    event DiplomaRevoked(bytes32 indexed docHash, address indexed issuer, uint64 revokedAt);

    constructor() {
        owner = msg.sender;
    }

    // ===== modifiers (cheaper branching) =====

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyIssuer(address sender) {
        if (!isIssuer[sender]) revert OnlyIssuer();
        _;
    }

    // ===== admin =====

    function addIssuer(address issuer) external onlyOwner {
        if (issuer == address(0)) revert BadIssuer();

        // idempotent: saves gas if called twice for same issuer
        if (isIssuer[issuer]) return;

        isIssuer[issuer] = true;
        emit IssuerAdded(issuer);
    }

    function removeIssuer(address issuer) external onlyOwner {
        // idempotent
        if (!isIssuer[issuer]) return;

        isIssuer[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    // ===== core =====

    function issue(bytes32 docHash) external onlyIssuer(msg.sender) {
        if (docHash == bytes32(0)) revert BadHash();

        Record storage r = records[docHash];
        if (r.issuer != address(0)) revert AlreadyIssued();

        uint64 ts = uint64(block.timestamp);

        records[docHash] = Record({
            issuer: msg.sender,
            issuedAt: ts,
            revokedAt: 0
        });

        emit DiplomaIssued(docHash, msg.sender, ts);
    }

    function revoke(bytes32 docHash) external onlyIssuer(msg.sender) {
        Record storage r = records[docHash];
        if (r.issuer != msg.sender) revert NotIssuerOfRecord();
        if (r.revokedAt != 0) revert AlreadyRevoked();

        uint64 ts = uint64(block.timestamp);

        r.revokedAt = ts;
        emit DiplomaRevoked(docHash, msg.sender, ts);
    }

    // ===== views =====

    function status(bytes32 docHash) external view returns (Status) {
        Record storage r = records[docHash];
        if (r.issuer == address(0)) return Status.Unknown;
        if (r.revokedAt != 0) return Status.Revoked;
        return Status.Valid;
    }

    function get(bytes32 docHash) external view returns (address issuer, uint64 issuedAt, uint64 revokedAt) {
        Record storage r = records[docHash];
        return (r.issuer, r.issuedAt, r.revokedAt);
    }
}
