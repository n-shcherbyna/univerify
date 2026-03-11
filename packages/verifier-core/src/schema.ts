import { z } from "zod";

export const DiplomaPayloadSchema = z.object({
  student: z.object({
    firstName: z.string().min(1).max(100),
    lastName: z.string().min(1).max(100),
    studentId: z.string().min(1).max(50),
  }),
  degree: z.object({
    name: z.string().min(1).max(200),
    level: z.string().min(1).max(50),
  }),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  diplomaNumber: z.string().min(1).max(100),
});

export type DiplomaPayload = z.infer<typeof DiplomaPayloadSchema>;

export function formatZodError(e: unknown): string {
  if (e instanceof z.ZodError) {
    return e.issues
      .map((iss) => {
        const path = iss.path.length ? iss.path.join(".") + ": " : "";
        return `${path}${iss.message}`;
      })
      .join("; ");
  }
  return e instanceof Error ? e.message : String(e);
}
