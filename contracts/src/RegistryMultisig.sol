// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title RegistryMultisig — minimal m-of-n multisig
/// @notice Threshold-gated transaction queue. Owner set and threshold are
///         mutable only via self-governed rotation (see addOwner/removeOwner/
///         changeThreshold, all onlySelf, i.e. require an executed m-of-n tx).
contract RegistryMultisig {
    error NotOwner();
    error OnlySelf();
    error ZeroOwner();
    error DuplicateOwner();
    error UnknownOwner();
    error InvalidThreshold();
    error UnknownTx();
    error AlreadyConfirmed();
    error NotConfirmed();
    error AlreadyExecuted();
    error NotEnoughConfirmations();
    error CallFailed();

    struct Transaction {
        address target;
        uint256 value;
        bytes data;
        bool executed;
    }

    address[] private owners;
    mapping(address => bool) public isOwner;
    uint256 public threshold;

    Transaction[] private transactions;
    mapping(uint256 => mapping(address => bool)) public confirmed;
    // No running counter: confirmationCount() re-derives the tally from the CURRENT owner set so a removed owner's stale confirmation stops counting (ConsenSys MultiSigWallet pattern).

    event Submitted(uint256 indexed txId, address indexed proposer, address target, uint256 value, bytes data);
    event Confirmed(uint256 indexed txId, address indexed owner);
    event Revoked(uint256 indexed txId, address indexed owner);
    event Executed(uint256 indexed txId);
    event OwnerAdded(address indexed owner);
    event OwnerRemoved(address indexed owner);
    event ThresholdChanged(uint256 threshold);

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    modifier onlySelf() {
        if (msg.sender != address(this)) revert OnlySelf();
        _;
    }

    constructor(address[] memory _owners, uint256 _threshold) {
        for (uint256 i = 0; i < _owners.length; i++) {
            address o = _owners[i];
            if (o == address(0)) revert ZeroOwner();
            if (isOwner[o]) revert DuplicateOwner();
            isOwner[o] = true;
            owners.push(o);
        }
        _setThreshold(_threshold);
    }

    // ── Transactions ─────────────────────────────────────────────────────────

    function submit(address target, uint256 value, bytes calldata data)
        external
        onlyOwner
        returns (uint256 txId)
    {
        txId = transactions.length;
        transactions.push(Transaction({target: target, value: value, data: data, executed: false}));
        emit Submitted(txId, msg.sender, target, value, data);
        _confirm(txId);
    }

    function confirm(uint256 txId) external onlyOwner {
        _confirm(txId);
    }

    function _confirm(uint256 txId) private {
        if (txId >= transactions.length) revert UnknownTx();
        if (transactions[txId].executed) revert AlreadyExecuted();
        if (confirmed[txId][msg.sender]) revert AlreadyConfirmed();
        confirmed[txId][msg.sender] = true;
        emit Confirmed(txId, msg.sender);
    }

    function revoke(uint256 txId) external onlyOwner {
        if (txId >= transactions.length) revert UnknownTx();
        if (transactions[txId].executed) revert AlreadyExecuted();
        if (!confirmed[txId][msg.sender]) revert NotConfirmed();
        confirmed[txId][msg.sender] = false;
        emit Revoked(txId, msg.sender);
    }

    function execute(uint256 txId) external onlyOwner {
        if (txId >= transactions.length) revert UnknownTx();
        Transaction storage t = transactions[txId];
        if (t.executed) revert AlreadyExecuted();
        if (confirmationCount(txId) < threshold) revert NotEnoughConfirmations();
        t.executed = true; // effects before interaction (reentrancy-safe)
        (bool ok, ) = t.target.call{value: t.value}(t.data);
        if (!ok) revert CallFailed();
        emit Executed(txId);
    }

    // ── Self-governed rotation (onlySelf → require m-of-n) ────────────────────

    function addOwner(address newOwner) external onlySelf {
        if (newOwner == address(0)) revert ZeroOwner();
        if (isOwner[newOwner]) revert DuplicateOwner();
        isOwner[newOwner] = true;
        owners.push(newOwner);
        emit OwnerAdded(newOwner);
    }

    function removeOwner(address owner) external onlySelf {
        if (!isOwner[owner]) revert UnknownOwner();
        if (owners.length - 1 < threshold) revert InvalidThreshold();
        isOwner[owner] = false;
        for (uint256 i = 0; i < owners.length; i++) {
            if (owners[i] == owner) {
                owners[i] = owners[owners.length - 1];
                owners.pop();
                break;
            }
        }
        emit OwnerRemoved(owner);
    }

    function changeThreshold(uint256 newThreshold) external onlySelf {
        _setThreshold(newThreshold);
    }

    function _setThreshold(uint256 newThreshold) private {
        if (newThreshold == 0 || newThreshold > owners.length) revert InvalidThreshold();
        threshold = newThreshold;
        emit ThresholdChanged(newThreshold);
    }

    // ── Views ────────────────────────────────────────────────────────────────

    function getOwners() external view returns (address[] memory) {
        return owners;
    }

    function ownerCount() external view returns (uint256) {
        return owners.length;
    }

    function txCount() external view returns (uint256) {
        return transactions.length;
    }

    /// @notice Confirmations counted over the CURRENT owner set only, so a
    ///         removed owner's stale confirmation stops counting immediately.
    function confirmationCount(uint256 txId) public view returns (uint256 count) {
        for (uint256 i = 0; i < owners.length; i++) {
            if (confirmed[txId][owners[i]]) count += 1;
        }
    }

    function getTx(uint256 txId)
        external
        view
        returns (address target, uint256 value, bytes memory data, bool executed)
    {
        if (txId >= transactions.length) revert UnknownTx();
        Transaction storage t = transactions[txId];
        return (t.target, t.value, t.data, t.executed);
    }

    receive() external payable {}
}
