// Merkle utilities live in @univerify/verifier-core so they can be shared with the CLI and SDK.
// Re-export everything for backward compatibility with existing web app imports.
export {
  computeMerkleLeaf,
  buildMerkleFromLeaves,
  computeRootFromProof,
} from "@univerify/verifier-core";
