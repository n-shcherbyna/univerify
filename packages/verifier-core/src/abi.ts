export const DiplomaRegistryAbi = [
  // errors
  { type: "error", name: "OnlyOwner", inputs: [] },
  { type: "error", name: "OnlyIssuer", inputs: [] },
  { type: "error", name: "NoChange", inputs: [] },
  { type: "error", name: "BadIssuer", inputs: [] },
  { type: "error", name: "BadUniversityId", inputs: [] },
  { type: "error", name: "BadUniversityStatus", inputs: [] },
  { type: "error", name: "BadName", inputs: [] },
  { type: "error", name: "UniversityNotActive", inputs: [] },
  { type: "error", name: "BadHash", inputs: [] },
  { type: "error", name: "BadRoot", inputs: [] },
  { type: "error", name: "BatchAlreadyIssued", inputs: [] },
  { type: "error", name: "NotIssuerOfBatch", inputs: [] },
  { type: "error", name: "AlreadyRevoked", inputs: [] },
  { type: "error", name: "InvalidProof", inputs: [] },
  { type: "error", name: "OnlyPendingOwner", inputs: [] },
  { type: "error", name: "NewOwnerIsZero", inputs: [] },

  // view
  { type: "function", name: "owner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "pendingOwner", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  {
    type: "function", name: "statusWithProof", stateMutability: "view",
    inputs: [
      { name: "docHash", type: "bytes32" }, { name: "issuer_", type: "address" },
      { name: "batchId", type: "uint64" }, { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function", name: "isRevoked", stateMutability: "view",
    inputs: [{ name: "docHash", type: "bytes32" }, { name: "issuer_", type: "address" }, { name: "batchId", type: "uint64" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "getBatch", stateMutability: "view",
    inputs: [{ name: "issuer_", type: "address" }, { name: "batchId", type: "uint64" }],
    outputs: [{ name: "", type: "bytes32" }],
  },
  {
    type: "function", name: "isIssuer", stateMutability: "view",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "issuerUniversityId", stateMutability: "view",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [{ name: "", type: "uint64" }],
  },
  {
    type: "function", name: "getUniversityStatus", stateMutability: "view",
    inputs: [{ name: "universityId", type: "uint64" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function", name: "isUniversityActive", stateMutability: "view",
    inputs: [{ name: "universityId", type: "uint64" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "verifyBatchMembership", stateMutability: "view",
    inputs: [
      { name: "docHash", type: "bytes32" }, { name: "issuer_", type: "address" },
      { name: "batchId", type: "uint64" }, { name: "proof", type: "bytes32[]" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function", name: "merkleLeaf", stateMutability: "view",
    inputs: [
      { name: "docHash", type: "bytes32" }, { name: "batchId", type: "uint64" }, { name: "issuer_", type: "address" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },

  // write
  {
    type: "function", name: "setUniversity", stateMutability: "nonpayable",
    inputs: [
      { name: "universityId", type: "uint64" }, { name: "status", type: "uint8" },
      { name: "name", type: "string" }, { name: "country", type: "string" },
      { name: "website", type: "string" }, { name: "accreditationId", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "onboardIssuerAndUniversity", stateMutability: "nonpayable",
    inputs: [
      { name: "issuer", type: "address" }, { name: "universityId", type: "uint64" },
      { name: "name", type: "string" }, { name: "country", type: "string" },
      { name: "website", type: "string" }, { name: "accreditationId", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "removeIssuer", stateMutability: "nonpayable",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [],
  },
  {
    type: "function", name: "issueBatchRoot", stateMutability: "nonpayable",
    inputs: [{ name: "batchId", type: "uint64" }, { name: "merkleRoot", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function", name: "revokeFromBatch", stateMutability: "nonpayable",
    inputs: [
      { name: "docHash", type: "bytes32" }, { name: "batchId", type: "uint64" }, { name: "proof", type: "bytes32[]" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "transferOwnership", stateMutability: "nonpayable",
    inputs: [{ name: "newOwner", type: "address" }],
    outputs: [],
  },
  {
    type: "function", name: "acceptOwnership", stateMutability: "nonpayable",
    inputs: [],
    outputs: [],
  },

  // events
  { type: "event", name: "IssuerAdded", inputs: [{ name: "issuer", type: "address", indexed: true }], anonymous: false },
  { type: "event", name: "IssuerRemoved", inputs: [{ name: "issuer", type: "address", indexed: true }], anonymous: false },
  {
    type: "event", name: "UniversitySet",
    inputs: [
      { name: "universityId", type: "uint64", indexed: true },
      { name: "status", type: "uint8", indexed: true },
      { name: "name", type: "string", indexed: false },
      { name: "country", type: "string", indexed: false },
      { name: "website", type: "string", indexed: false },
      { name: "accreditationId", type: "string", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event", name: "DiplomaRevoked",
    inputs: [
      { name: "docHash", type: "bytes32", indexed: true },
      { name: "issuer", type: "address", indexed: true },
      { name: "revokedAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event", name: "BatchIssued",
    inputs: [
      { name: "batchId", type: "uint64", indexed: true },
      { name: "merkleRoot", type: "bytes32", indexed: true },
      { name: "issuer", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event", name: "OwnershipTransferStarted",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
    anonymous: false,
  },
  {
    type: "event", name: "OwnershipTransferred",
    inputs: [
      { name: "previousOwner", type: "address", indexed: true },
      { name: "newOwner", type: "address", indexed: true },
    ],
    anonymous: false,
  },
] as const;

export const RegistryMultisigAbi = [
  { type: "error", name: "NotOwner", inputs: [] },
  { type: "error", name: "OnlySelf", inputs: [] },
  { type: "error", name: "ZeroOwner", inputs: [] },
  { type: "error", name: "DuplicateOwner", inputs: [] },
  { type: "error", name: "UnknownOwner", inputs: [] },
  { type: "error", name: "InvalidThreshold", inputs: [] },
  { type: "error", name: "UnknownTx", inputs: [] },
  { type: "error", name: "AlreadyConfirmed", inputs: [] },
  { type: "error", name: "NotConfirmed", inputs: [] },
  { type: "error", name: "AlreadyExecuted", inputs: [] },
  { type: "error", name: "NotEnoughConfirmations", inputs: [] },
  { type: "error", name: "CallFailed", inputs: [] },
  {
    type: "function", name: "submit", stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
    ],
    outputs: [{ name: "txId", type: "uint256" }],
  },
  { type: "function", name: "confirm", stateMutability: "nonpayable", inputs: [{ name: "txId", type: "uint256" }], outputs: [] },
  { type: "function", name: "revoke", stateMutability: "nonpayable", inputs: [{ name: "txId", type: "uint256" }], outputs: [] },
  { type: "function", name: "execute", stateMutability: "nonpayable", inputs: [{ name: "txId", type: "uint256" }], outputs: [] },
  { type: "function", name: "addOwner", stateMutability: "nonpayable", inputs: [{ name: "newOwner", type: "address" }], outputs: [] },
  { type: "function", name: "removeOwner", stateMutability: "nonpayable", inputs: [{ name: "owner", type: "address" }], outputs: [] },
  { type: "function", name: "changeThreshold", stateMutability: "nonpayable", inputs: [{ name: "newThreshold", type: "uint256" }], outputs: [] },
  { type: "function", name: "getOwners", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "ownerCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "txCount", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "threshold", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isOwner", stateMutability: "view", inputs: [{ name: "", type: "address" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "confirmationCount", stateMutability: "view", inputs: [{ name: "txId", type: "uint256" }], outputs: [{ name: "", type: "uint256" }] },
  {
    type: "function", name: "getTx", stateMutability: "view",
    inputs: [{ name: "txId", type: "uint256" }],
    outputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "executed", type: "bool" },
    ],
  },
  {
    type: "event", name: "Submitted", anonymous: false,
    inputs: [
      { name: "txId", type: "uint256", indexed: true },
      { name: "proposer", type: "address", indexed: true },
      { name: "target", type: "address", indexed: false },
      { name: "value", type: "uint256", indexed: false },
      { name: "data", type: "bytes", indexed: false },
    ],
  },
  { type: "event", name: "Confirmed", anonymous: false, inputs: [{ name: "txId", type: "uint256", indexed: true }, { name: "owner", type: "address", indexed: true }] },
  { type: "event", name: "Executed", anonymous: false, inputs: [{ name: "txId", type: "uint256", indexed: true }] },
] as const;

// Minimal subset of OZ 5.6.1 TimelockController used by UniVerify governance.
export const TimelockControllerAbi = [
  {
    type: "function", name: "schedule", stateMutability: "nonpayable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
      { name: "delay", type: "uint256" },
    ],
    outputs: [],
  },
  {
    type: "function", name: "execute", stateMutability: "payable",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "payload", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [],
  },
  { type: "function", name: "cancel", stateMutability: "nonpayable", inputs: [{ name: "id", type: "bytes32" }], outputs: [] },
  {
    type: "function", name: "hashOperation", stateMutability: "pure",
    inputs: [
      { name: "target", type: "address" },
      { name: "value", type: "uint256" },
      { name: "data", type: "bytes" },
      { name: "predecessor", type: "bytes32" },
      { name: "salt", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bytes32" }],
  },
  { type: "function", name: "getMinDelay", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "getTimestamp", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "isOperation", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isOperationPending", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isOperationReady", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "isOperationDone", stateMutability: "view", inputs: [{ name: "id", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] },
  {
    type: "event", name: "CallScheduled", anonymous: false,
    inputs: [
      { name: "id", type: "bytes32", indexed: true },
      { name: "index", type: "uint256", indexed: true },
      { name: "target", type: "address", indexed: false },
      { name: "value", type: "uint256", indexed: false },
      { name: "data", type: "bytes", indexed: false },
      { name: "predecessor", type: "bytes32", indexed: false },
      { name: "delay", type: "uint256", indexed: false },
    ],
  },
  { type: "event", name: "Cancelled", anonymous: false, inputs: [{ name: "id", type: "bytes32", indexed: true }] },
] as const;

export type StatusCode = 0 | 1 | 2;
