export const DiplomaRegistryAbi = [
  // view
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
      { name: "issuedAt", type: "uint64" },
      { name: "revoked", type: "bool" },
    ],
  },

  // write
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
] as const;

export type StatusCode = 0 | 1 | 2; // Unknown, Valid, Revoked
