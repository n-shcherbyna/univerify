export const DiplomaRegistryAbi = [
  {
    type: "function",
    name: "status",
    stateMutability: "view",
    inputs: [{ name: "docHash", type: "bytes32" }],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export type StatusCode = 0 | 1 | 2; // Unknown, Valid, Revoked
