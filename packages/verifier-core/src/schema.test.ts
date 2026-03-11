import { describe, it, expect } from "vitest";
import { DiplomaPayloadSchema, formatZodError, type DiplomaPayload } from "./schema.js";

const VALID: DiplomaPayload = {
  student: { firstName: "Jan", lastName: "Kowalski", studentId: "s123456" },
  degree: { name: "Bachelor of Computer Science", level: "BSc" },
  issuedAt: "2025-06-30",
  diplomaNumber: "UV-2025-000123",
};

describe("DiplomaPayloadSchema — valid inputs", () => {
  it("accepts a fully valid payload", () => {
    expect(() => DiplomaPayloadSchema.parse(VALID)).not.toThrow();
  });

  it("parse returns typed object with correct values", () => {
    const result = DiplomaPayloadSchema.parse(VALID);
    expect(result.student.firstName).toBe("Jan");
    expect(result.diplomaNumber).toBe("UV-2025-000123");
  });

  it("accepts single-character names (min=1)", () => {
    const p = { ...VALID, student: { ...VALID.student, firstName: "A" } };
    expect(() => DiplomaPayloadSchema.parse(p)).not.toThrow();
  });

  it("accepts names at max length boundary (100 chars)", () => {
    const p = { ...VALID, student: { ...VALID.student, firstName: "a".repeat(100) } };
    expect(() => DiplomaPayloadSchema.parse(p)).not.toThrow();
  });
});

describe("DiplomaPayloadSchema — required fields", () => {
  it("rejects missing diplomaNumber", () => {
    const { diplomaNumber: _dn, ...bad } = VALID;
    expect(() => DiplomaPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects missing student object", () => {
    const { student: _s, ...bad } = VALID;
    expect(() => DiplomaPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects missing degree object", () => {
    const { degree: _d, ...bad } = VALID;
    expect(() => DiplomaPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects missing issuedAt", () => {
    const { issuedAt: _ia, ...bad } = VALID;
    expect(() => DiplomaPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects missing student.studentId", () => {
    const bad = { ...VALID, student: { firstName: "Jan", lastName: "K" } };
    expect(() => DiplomaPayloadSchema.parse(bad)).toThrow();
  });

  it("rejects missing degree.level", () => {
    const bad = { ...VALID, degree: { name: "BSc CS" } };
    expect(() => DiplomaPayloadSchema.parse(bad)).toThrow();
  });
});

describe("DiplomaPayloadSchema — string constraints", () => {
  it("rejects empty firstName", () => {
    expect(() =>
      DiplomaPayloadSchema.parse({ ...VALID, student: { ...VALID.student, firstName: "" } })
    ).toThrow();
  });

  it("rejects firstName over 100 chars", () => {
    expect(() =>
      DiplomaPayloadSchema.parse({ ...VALID, student: { ...VALID.student, firstName: "a".repeat(101) } })
    ).toThrow();
  });

  it("rejects studentId over 50 chars", () => {
    expect(() =>
      DiplomaPayloadSchema.parse({ ...VALID, student: { ...VALID.student, studentId: "x".repeat(51) } })
    ).toThrow();
  });

  it("rejects degree.name over 200 chars", () => {
    expect(() =>
      DiplomaPayloadSchema.parse({ ...VALID, degree: { ...VALID.degree, name: "n".repeat(201) } })
    ).toThrow();
  });

  it("rejects empty diplomaNumber", () => {
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, diplomaNumber: "" })).toThrow();
  });

  it("rejects diplomaNumber over 100 chars", () => {
    expect(() =>
      DiplomaPayloadSchema.parse({ ...VALID, diplomaNumber: "x".repeat(101) })
    ).toThrow();
  });
});

describe("DiplomaPayloadSchema — issuedAt format", () => {
  it("accepts valid ISO date YYYY-MM-DD", () => {
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, issuedAt: "2000-01-01" })).not.toThrow();
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, issuedAt: "2099-12-31" })).not.toThrow();
  });

  it("rejects DD-MM-YYYY format", () => {
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, issuedAt: "30-06-2025" })).toThrow();
  });

  it("rejects YYYY/MM/DD format", () => {
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, issuedAt: "2025/06/30" })).toThrow();
  });

  it("rejects single-digit month", () => {
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, issuedAt: "2025-6-30" })).toThrow();
  });

  it("rejects partial date", () => {
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, issuedAt: "2025-06" })).toThrow();
  });

  it("rejects non-date string", () => {
    expect(() => DiplomaPayloadSchema.parse({ ...VALID, issuedAt: "today" })).toThrow();
  });
});

describe("formatZodError", () => {
  it("formats a ZodError with path and message", () => {
    const result = DiplomaPayloadSchema.safeParse({ ...VALID, diplomaNumber: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain("diplomaNumber");
    }
  });

  it("formats multiple issues separated by semicolons", () => {
    const result = DiplomaPayloadSchema.safeParse({});
    expect(result.success).toBe(false);
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain(";");
    }
  });

  it("handles non-ZodError (plain Error)", () => {
    expect(formatZodError(new Error("plain error"))).toBe("plain error");
  });

  it("handles unknown non-error value", () => {
    expect(formatZodError("raw string")).toBe("raw string");
  });
});
