// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

contract DiplomaRegistryF2 {
    enum Status { Unknown, Valid, Revoked }

    error OnlyOwner();
    error OnlyIssuer();
    error BadIssuer();
    error BadHash();
    error AlreadyIssued();
    error NotIssuerOfRecord();
    error AlreadyRevoked();

    address public immutable owner;

    mapping(address => bool) public isIssuer;
    mapping(bytes32 => uint256) private rec; // packed

    event IssuerAdded(address issuer);
    event IssuerRemoved(address issuer);
    event DiplomaIssued(bytes32 indexed docHash, address indexed issuer, uint64 issuedAt);
    event DiplomaRevoked(bytes32 indexed docHash, address indexed issuer, uint64 revokedAt);

    uint256 private constant REVOKED_MASK = 1 << 160;
    uint256 private constant ISSUER_MASK  = (uint256(1) << 160) - 1;

    modifier onlyOwner() {
        if (msg.sender != owner) revert OnlyOwner();
        _;
    }

    modifier onlyIssuer() {
        if (!isIssuer[msg.sender]) revert OnlyIssuer();
        _;
    }

    constructor() { owner = msg.sender; }

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
        uint256 p = rec[docHash];
        if ((p & ISSUER_MASK) != 0) revert AlreadyIssued();

        rec[docHash] = uint256(uint160(msg.sender)); // revoked bit = 0
        emit DiplomaIssued(docHash, msg.sender, uint64(block.timestamp));
    }

    function revoke(bytes32 docHash) external onlyIssuer {
        uint256 p = rec[docHash];
        address issuer = address(uint160(p & ISSUER_MASK));
        if (issuer != msg.sender) revert NotIssuerOfRecord();
        if ((p & REVOKED_MASK) != 0) revert AlreadyRevoked();

        rec[docHash] = p | REVOKED_MASK;
        emit DiplomaRevoked(docHash, msg.sender, uint64(block.timestamp));
    }

    function status(bytes32 docHash) external view returns (Status) {
        uint256 p = rec[docHash];
        if ((p & ISSUER_MASK) == 0) return Status.Unknown;
        if ((p & REVOKED_MASK) != 0) return Status.Revoked;
        return Status.Valid;
    }

    function get(bytes32 docHash) external view returns (address issuer, bool revoked) {
        uint256 p = rec[docHash];
        issuer = address(uint160(p & ISSUER_MASK));
        revoked = (p & REVOKED_MASK) != 0;
    }
}
