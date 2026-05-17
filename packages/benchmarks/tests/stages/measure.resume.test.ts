import { describe, it, expect } from "vitest";
import {
  resumeNeedsOp,
  markComplete,
  type ResumeProgress,
} from "../../src/stages/measureResume.js";

describe("resumeNeedsOp", () => {
  const empty: ResumeProgress = {};

  it("returns true when nothing is recorded", () => {
    expect(resumeNeedsOp(empty, "sepolia", "issueBatch", 100)).toBe(true);
  });

  it("returns false when (chain, op, size) is marked complete", () => {
    const prog: ResumeProgress = {
      sepolia: { issueBatch: { 100: "complete" } },
    };
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 100)).toBe(false);
  });

  it("returns true when a sibling size is complete but ours is not", () => {
    const prog: ResumeProgress = {
      sepolia: { issueBatch: { 100: "complete" } },
    };
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 1000)).toBe(true);
  });

  it("returns true when a different op is complete on the same chain", () => {
    const prog: ResumeProgress = {
      sepolia: { revokeBurst: "complete" },
    };
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 100)).toBe(true);
  });
});

describe("markComplete", () => {
  it("marks an issueBatch size complete", () => {
    const prog: ResumeProgress = {};
    markComplete(prog, "sepolia", "issueBatch", 100);
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 100)).toBe(false);
    expect(resumeNeedsOp(prog, "sepolia", "issueBatch", 1000)).toBe(true);
  });

  it("marks revokeBurst complete on a chain", () => {
    const prog: ResumeProgress = {};
    markComplete(prog, "baseSepolia", "revokeBurst");
    expect(resumeNeedsOp(prog, "baseSepolia", "revokeBurst")).toBe(false);
  });
});
