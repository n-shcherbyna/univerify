// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DiplomaRegistryB {
    enum Status { Unknown, Valid, Revoked }

    // 20 + 8 + 8 = 32 bytes => 1 storage slot
    struct Record {
        address issuer;
        uint64 issuedAt;
        uint64 revokedAt; // 0 => not revoked
    }

    address public owner;
    mapping(address => bool) public isIssuer;
    mapping(bytes32 => Record) private records;

    event IssuerAdded(address issuer);
    event IssuerRemoved(address issuer);
    event DiplomaIssued(bytes32 indexed docHash, address indexed issuer, uint64 issuedAt);
    event DiplomaRevoked(bytes32 indexed docHash, address indexed issuer, uint64 revokedAt);

    modifier onlyOwner() {
        require(msg.sender == owner, "ONLY_OWNER");
        _;
    }

    modifier onlyIssuer() {
        require(isIssuer[msg.sender], "ONLY_ISSUER");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addIssuer(address issuer) external onlyOwner {
        require(issuer != address(0), "BAD_ISSUER");
        isIssuer[issuer] = true;
        emit IssuerAdded(issuer);
    }

    function removeIssuer(address issuer) external onlyOwner {
        isIssuer[issuer] = false;
        emit IssuerRemoved(issuer);
    }

    function issue(bytes32 docHash) external onlyIssuer {
        require(docHash != bytes32(0), "BAD_HASH");
        Record storage r = records[docHash];
        require(r.issuer == address(0), "ALREADY_ISSUED");

        records[docHash] = Record({
            issuer: msg.sender,
            issuedAt: uint64(block.timestamp),
            revokedAt: 0
        });

        emit DiplomaIssued(docHash, msg.sender, uint64(block.timestamp));
    }

    function revoke(bytes32 docHash) external onlyIssuer {
        Record storage r = records[docHash];
        require(r.issuer == msg.sender, "NOT_ISSUER_OF_RECORD");
        require(r.revokedAt == 0, "ALREADY_REVOKED");

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
