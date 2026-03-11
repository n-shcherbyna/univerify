// Schema lives in @univerify/verifier-core so it can be shared with the CLI.
// Re-export everything for backward compatibility with existing web app imports.
export { DiplomaPayloadSchema, formatZodError } from "@univerify/verifier-core";
export type { DiplomaPayload } from "@univerify/verifier-core";
