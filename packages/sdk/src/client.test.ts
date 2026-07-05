import { describe, it, expect } from "vitest";
import type { Address, Hex } from "viem";
import {
  UniverifySdk,
  hashPayload,
  computeMerkleLeaf,
  buildMerkleFromLeaves,
  computeRootFromProof,
  DiplomaPayloadSchema,
  DiplomaRegistryAbi,
} from "./index";

// ─── Constructor ─────────────────────────────────────────────────────────────

describe("UniverifySdk constructor", () => {
  const config = {
    rpcUrl: "https://rpc.example.com",
    registryAddress: "0x0000000000000000000000000000000000000001" as Address,
    chainId: 11155111,
    deployBlock: 100n,
  };

  it("stores config values", () => {
    const sdk = new UniverifySdk(config);
    expect(sdk.registry).toBe(config.registryAddress);
    expect(sdk.chainId).toBe(config.chainId);
    expect(sdk.deployBlock).toBe(100n);
  });

  it("defaults deployBlock to 0n", () => {
    const sdk = new UniverifySdk({
      rpcUrl: "https://rpc.example.com",
      registryAddress: "0x0000000000000000000000000000000000000001" as Address,
      chainId: 1,
    });
    expect(sdk.deployBlock).toBe(0n);
  });

  it("exposes verify, status, getBatch, getIssuer, getUniversity methods", () => {
    const sdk = new UniverifySdk(config);
    expect(typeof sdk.verify).toBe("function");
    expect(typeof sdk.status).toBe("function");
    expect(typeof sdk.getBatch).toBe("function");
    expect(typeof sdk.getIssuer).toBe("function");
    expect(typeof sdk.getUniversity).toBe("function");
    expect(typeof sdk.getOwner).toBe("function");
    expect(typeof sdk.getPendingOwner).toBe("function");
  });
});

// ─── Re-exports from verifier-core ──────────────────────────────────────────

describe("SDK re-exports", () => {
  it("re-exports hashPayload", () => {
    const hash = hashPayload({ hello: "world" });
    expect(hash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("re-exports computeMerkleLeaf", () => {
    const leaf = computeMerkleLeaf({
      registry: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address,
      chainId: 1n,
      issuer: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address,
      batchId: 1n,
      docHash: `0x${"00".repeat(32)}` as Hex,
    });
    expect(leaf).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("re-exports buildMerkleFromLeaves and computeRootFromProof", () => {
    const h = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;
    const leaves = [h(1), h(2), h(3)];
    const { root, proofs } = buildMerkleFromLeaves(leaves);
    expect(root).toMatch(/^0x[0-9a-f]{64}$/);
    for (let i = 0; i < leaves.length; i++) {
      expect(computeRootFromProof({ leaf: leaves[i], proof: proofs[i] })).toBe(root);
    }
  });

  it("re-exports DiplomaPayloadSchema", () => {
    const valid = {
      student: { firstName: "Alice", lastName: "Smith", studentId: "S001" },
      degree: { name: "Computer Science", level: "BSc" },
      issuedAt: "2025-06-01",
      diplomaNumber: "D-001",
    };
    expect(DiplomaPayloadSchema.safeParse(valid).success).toBe(true);
    expect(DiplomaPayloadSchema.safeParse({}).success).toBe(false);
  });

  it("re-exports DiplomaRegistryAbi", () => {
    expect(Array.isArray(DiplomaRegistryAbi)).toBe(true);
    expect(DiplomaRegistryAbi.length).toBeGreaterThan(0);
    const names = DiplomaRegistryAbi.filter((e: any) => e.name).map((e: any) => e.name);
    expect(names).toContain("statusWithProof");
    expect(names).toContain("issueBatchRoot");
  });
});

// ─── Governance reads ────────────────────────────────────────────────────────

describe("governance reads", () => {
  const sdk = new UniverifySdk({
    rpcUrl: "http://127.0.0.1:8545",
    registryAddress: "0x0000000000000000000000000000000000000001",
    chainId: 31337,
  });

  it("classifies operation state from timestamp", () => {
    // _classifyOperation is a pure helper: (timestamp, nowSeconds) -> state
    expect(sdk._classifyOperation(0n, 1000n).state).toBe("Unset");
    expect(sdk._classifyOperation(1n, 1000n).state).toBe("Done");
    expect(sdk._classifyOperation(2000n, 1000n).state).toBe("Pending");
    expect(sdk._classifyOperation(1000n, 1000n).state).toBe("Ready");
  });
});
