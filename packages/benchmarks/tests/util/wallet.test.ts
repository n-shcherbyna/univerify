import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { loadBenchAccount } from "../../src/util/wallet.js";

const VALID = "0x" + "a".repeat(64);

describe("loadBenchAccount", () => {
  const originalPk = process.env.BENCH_PK;
  beforeEach(() => {
    delete process.env.BENCH_PK;
  });
  afterEach(() => {
    if (originalPk === undefined) delete process.env.BENCH_PK;
    else process.env.BENCH_PK = originalPk;
  });

  it("loads a valid private key", () => {
    process.env.BENCH_PK = VALID;
    const account = loadBenchAccount();
    expect(account.address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("rejects missing key", () => {
    expect(() => loadBenchAccount()).toThrow(/BENCH_PK is not set/);
  });

  it("rejects missing 0x prefix", () => {
    process.env.BENCH_PK = "a".repeat(64);
    expect(() => loadBenchAccount()).toThrow(/0x-prefixed/);
  });

  it("rejects wrong length", () => {
    process.env.BENCH_PK = "0x" + "a".repeat(60);
    expect(() => loadBenchAccount()).toThrow(/0x-prefixed/);
  });

  it("rejects non-hex characters", () => {
    process.env.BENCH_PK = "0x" + "z".repeat(64);
    expect(() => loadBenchAccount()).toThrow(/hex/);
  });
});
