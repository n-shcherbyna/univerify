// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DiplomaRegistryD {
    enum Status { Unknown, Valid, Revoked }

    // 20 + 8 + 8 = 32 bytes => 1 slot
    struct Record {
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt;
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

    function issue(bytes32 docHash) external onlyIssuer {
        if (docHash == bytes32(0)) revert BadHash();

        Record storage r = records[docHash];
        if (r.issuer != address(0)) revert AlreadyIssued();

        records[docHash] = Record({
            issuer: msg.sender,
            issuedAt: uint64(block.timestamp),
            revokedAt: 0
        });

        emit DiplomaIssued(docHash, msg.sender, uint64(block.timestamp));
    }

    function revoke(bytes32 docHash) external onlyIssuer {
        Record storage r = records[docHash];
        if (r.issuer != msg.sender) revert NotIssuerOfRecord();
        if (r.revokedAt != 0) revert AlreadyRevoked();

        r.revokedAt = uint64(block.timestamp);
        emit DiplomaRevoked(docHash, msg.sender, uint64(block.timestamp));
    }

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
