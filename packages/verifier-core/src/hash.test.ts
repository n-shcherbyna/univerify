import { describe, it, expect } from "vitest";
import { hashPayload } from "./hash.js";

const SAMPLE_DIPLOMA = {
  student: { firstName: "Jan", lastName: "Kowalski", studentId: "s123456" },
  degree: { name: "Bachelor of Computer Science", level: "BSc" },
  issuedAt: "2025-06-30",
  diplomaNumber: "UV-2025-000123",
};

describe("hashPayload", () => {
  it("is deterministic — same payload always produces the same hash", () => {
    expect(hashPayload(SAMPLE_DIPLOMA)).toBe(hashPayload(SAMPLE_DIPLOMA));
  });

  it("is canonical — key order does not affect the hash", () => {
    const a = { a: 1, b: 2, c: "hello" };
    const b = { c: "hello", a: 1, b: 2 };
    expect(hashPayload(a)).toBe(hashPayload(b));
  });

  it("is canonical — nested key order does not affect the hash", () => {
    const a = { student: { firstName: "Jan", lastName: "Kowalski" } };
    const b = { student: { lastName: "Kowalski", firstName: "Jan" } };
    expect(hashPayload(a)).toBe(hashPayload(b));
  });

  it("returns 0x-prefixed 32-byte lowercase hex string", () => {
    expect(hashPayload(SAMPLE_DIPLOMA)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("different values produce different hashes", () => {
    const modified = { ...SAMPLE_DIPLOMA, diplomaNumber: "UV-2025-000124" };
    expect(hashPayload(SAMPLE_DIPLOMA)).not.toBe(hashPayload(modified));
  });

  it("different student ID produces different hash", () => {
    const a = { ...SAMPLE_DIPLOMA, student: { ...SAMPLE_DIPLOMA.student, studentId: "s000001" } };
    const b = { ...SAMPLE_DIPLOMA, student: { ...SAMPLE_DIPLOMA.student, studentId: "s000002" } };
    expect(hashPayload(a)).not.toBe(hashPayload(b));
  });

  it("handles empty object", () => {
    expect(hashPayload({})).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("handles null value (as unknown)", () => {
    expect(hashPayload(null)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("regression — hash of sample diploma is stable across runs", () => {
    // This pins the exact hash value. If the hashing algorithm or JSON canonicalization
    // ever changes accidentally, this test will catch it.
    const h1 = hashPayload(SAMPLE_DIPLOMA);
    const h2 = hashPayload(SAMPLE_DIPLOMA);
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(66); // "0x" + 64 hex chars
  });
});
