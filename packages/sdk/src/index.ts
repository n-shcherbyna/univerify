export { UniverifySdk } from "./client.js";
export type {
  SdkConfig,
  DiplomaEnvelope,
  VerifyResult,
  StatusResult,
  UniversityInfo,
  IssuerInfo,
  BatchInfo,
  PrivateDiplomaEnvelope,
  SelectiveVerifyResult,
  OperationState,
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

// Re-export privacy utilities from verifier-core
export {
  generateFieldSalts,
  computeFieldCommitments,
  computePrivateDocHash,
  verifyDisclosedFields,
  DISCLOSURE_FIELDS,
  type FieldSalts,
  type FieldCommitments,
  type DisclosedFields,
  type DisclosedEntry,
  type DisclosureField,
} from "@univerify/verifier-core";
