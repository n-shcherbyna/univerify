import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { atomicWriteJson } from "../../src/util/atomicWrite.js";

describe("atomicWriteJson", () => {
  it("writes the final file via .tmp+rename", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const target = path.join(dir, "out.json");
    atomicWriteJson(target, { hello: "world" });
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ hello: "world" });
    expect(fs.existsSync(`${target}.tmp`)).toBe(false);
  });

  it("does not leave a corrupted file if the JSON write throws", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));
    const target = path.join(dir, "out.json");
    fs.writeFileSync(target, '{"old": true}');
    const bad: any = { circular: {} };
    bad.circular.self = bad;
    expect(() => atomicWriteJson(target, bad)).toThrow();
    // Original file untouched:
    expect(JSON.parse(fs.readFileSync(target, "utf8"))).toEqual({ old: true });
  });
});
