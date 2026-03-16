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

export type StatusCode = 0 | 1 | 2;
