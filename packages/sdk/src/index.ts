export { UniverifySdk } from "./client.js";
export type {
  SdkConfig,
  DiplomaEnvelope,
  VerifyResult,
  StatusResult,
  UniversityInfo,
  IssuerInfo,
  BatchInfo,
} from "./client.js";

// Re-export commonly needed utilities from verifier-core
export {
  hashPayload,
  computeMerkleLeaf,
  buildMerkleFromLeaves,
  computeRootFromProof,
  DiplomaPayloadSchema,
  DiplomaRegistryAbi,
  type StatusCode,
  type DiplomaPayload,
} from "@univerify/verifier-core";
