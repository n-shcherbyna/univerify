export const DiplomaRegistryAbi = [
  // errors
  { type: "error", name: "OnlyOwner", inputs: [] },
  { type: "error", name: "OnlyIssuer", inputs: [] },
  { type: "error", name: "BadIssuer", inputs: [] },
  { type: "error", name: "BadHash", inputs: [] },
  { type: "error", name: "AlreadyIssued", inputs: [] },
  { type: "error", name: "NotIssuerOfRecord", inputs: [] },
  { type: "error", name: "AlreadyRevoked", inputs: [] },

  // view
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [{ name: "docHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
  {
    type: "function",
    name: "get",
    stateMutability: "view",
    inputs: [{ name: "docHash", type: "bytes32" }],
    outputs: [
      { name: "issuer", type: "address" },
      { name: "revoked", type: "bool" },
    ],
  },
  {
    type: "function",
    name: "isIssuer",
    stateMutability: "view",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },

  // write
  {
    type: "function",
    name: "addIssuer",
    stateMutability: "nonpayable",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "removeIssuer",
    stateMutability: "nonpayable",
    inputs: [{ name: "issuer", type: "address" }],
    outputs: [],
  },
  {
    type: "function",
    name: "issue",
    stateMutability: "nonpayable",
    inputs: [{ name: "docHash", type: "bytes32" }],
    outputs: [],
  },
  {
    type: "function",
    name: "revoke",
    stateMutability: "nonpayable",
    inputs: [{ name: "docHash", type: "bytes32" }],
    outputs: [],
  },

  // events (opcjonalnie, ale zwykle warto)
  { type: "event", name: "IssuerAdded", inputs: [{ name: "issuer", type: "address", indexed: false }], anonymous: false },
  { type: "event", name: "IssuerRemoved", inputs: [{ name: "issuer", type: "address", indexed: false }], anonymous: false },
  {
    type: "event",
    name: "DiplomaIssued",
    inputs: [
      { name: "docHash", type: "bytes32", indexed: true },
      { name: "issuer", type: "address", indexed: true },
      { name: "issuedAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
  {
    type: "event",
    name: "DiplomaRevoked",
    inputs: [
      { name: "docHash", type: "bytes32", indexed: true },
      { name: "issuer", type: "address", indexed: true },
      { name: "revokedAt", type: "uint64", indexed: false },
    ],
    anonymous: false,
  },
] as const;
export type StatusCode = 0 | 1 | 2; // Unknown | Valid | Revoked
