import { describe, it, expect } from "vitest";
import type { Address, Hex } from "viem";
import { buildMerkleFromLeaves, computeRootFromProof, computeMerkleLeaf } from "./merkle";

// Helper: create a predictable bytes32 hex from a small integer
const h = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}` as Hex;

const REGISTRY = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Address;
const ISSUER   = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Address;

// ─── buildMerkleFromLeaves ────────────────────────────────────────────────────

describe("buildMerkleFromLeaves", () => {
  it("throws on empty leaf array", () => {
    expect(() => buildMerkleFromLeaves([])).toThrow();
  });

  it("single leaf: proof is empty, root reconstructs from empty proof", () => {
    const leaves = [h(1)];
    const { root, proofs } = buildMerkleFromLeaves(leaves);
    expect(proofs[0]).toHaveLength(0);
    expect(computeRootFromProof({ leaf: leaves[0], proof: [] })).toBe(root);
  });

  it("returns stable root for the same input", () => {
    const leaves = [h(1), h(2), h(3)];
    expect(buildMerkleFromLeaves(leaves).root).toBe(buildMerkleFromLeaves(leaves).root);
  });

  it("two leaves: proof depth is 1", () => {
    const leaves = [h(1), h(2)];
    const { proofs } = buildMerkleFromLeaves(leaves);
    expect(proofs[0]).toHaveLength(1);
    expect(proofs[1]).toHaveLength(1);
  });

  it("proofs array length equals leaves length", () => {
    for (const count of [1, 2, 3, 4, 5, 8, 9]) {
      const leaves = Array.from({ length: count }, (_, i) => h(i + 1));
      const { proofs } = buildMerkleFromLeaves(leaves);
      expect(proofs).toHaveLength(count);
    }
  });
});

// ─── round-trip: buildMerkleFromLeaves + computeRootFromProof ────────────────

describe("Merkle round-trip — all proofs reconstruct the root", () => {
  for (const count of [1, 2, 3, 4, 7, 8, 9, 16]) {
    it(`${count} leaf/leaves`, () => {
      const leaves = Array.from({ length: count }, (_, i) => h(i + 1));
      const { root, proofs } = buildMerkleFromLeaves(leaves);
      for (let i = 0; i < leaves.length; i++) {
        expect(computeRootFromProof({ leaf: leaves[i], proof: proofs[i] })).toBe(root);
      }
    });
  }
});

// ─── tamper detection ────────────────────────────────────────────────────────

describe("Merkle tamper detection", () => {
  it("tampered leaf does not reconstruct the root", () => {
    const leaves = [h(1), h(2), h(3)];
    const { root, proofs } = buildMerkleFromLeaves(leaves);
    expect(computeRootFromProof({ leaf: h(99), proof: proofs[0] })).not.toBe(root);
  });

  it("proof for leaf[0] does not verify leaf[1] (cross-proof)", () => {
    const leaves = [h(1), h(2), h(3)];
    const { root, proofs } = buildMerkleFromLeaves(leaves);
    expect(computeRootFromProof({ leaf: leaves[0], proof: proofs[1] })).not.toBe(root);
  });

  it("proof for leaf[0] does not verify leaf[2]", () => {
    const leaves = [h(1), h(2), h(3), h(4)];
    const { root, proofs } = buildMerkleFromLeaves(leaves);
    expect(computeRootFromProof({ leaf: leaves[0], proof: proofs[2] })).not.toBe(root);
  });

  it("modified sibling in proof breaks reconstruction", () => {
    const leaves = [h(1), h(2)];
    const { root, proofs } = buildMerkleFromLeaves(leaves);
    const tamperedProof = [h(99)] as Hex[];
    expect(computeRootFromProof({ leaf: leaves[0], proof: tamperedProof })).not.toBe(root);
  });
});

// ─── computeMerkleLeaf ───────────────────────────────────────────────────────

describe("computeMerkleLeaf", () => {
  const base = {
    registry: REGISTRY,
    chainId: 11155111n,
    issuer: ISSUER,
    batchId: 1n,
    docHash: h(42),
  };

  it("is deterministic", () => {
    expect(computeMerkleLeaf(base)).toBe(computeMerkleLeaf(base));
  });

  it("returns 0x-prefixed 32-byte lowercase hex", () => {
    expect(computeMerkleLeaf(base)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("differs with different issuer", () => {
    const other = { ...base, issuer: "0xcccccccccccccccccccccccccccccccccccccccc" as Address };
    expect(computeMerkleLeaf(base)).not.toBe(computeMerkleLeaf(other));
  });

  it("differs with different batchId", () => {
    expect(computeMerkleLeaf(base)).not.toBe(computeMerkleLeaf({ ...base, batchId: 2n }));
  });

  it("differs with different chainId", () => {
    expect(computeMerkleLeaf(base)).not.toBe(computeMerkleLeaf({ ...base, chainId: 1n }));
  });

  it("differs with different registry address", () => {
    const other = { ...base, registry: "0xdddddddddddddddddddddddddddddddddddddddd" as Address };
    expect(computeMerkleLeaf(base)).not.toBe(computeMerkleLeaf(other));
  });

  it("differs with different docHash", () => {
    expect(computeMerkleLeaf(base)).not.toBe(computeMerkleLeaf({ ...base, docHash: h(43) }));
  });

  it("leaf can be used as input to buildMerkleFromLeaves round-trip", () => {
    const leaf = computeMerkleLeaf(base);
    const { root, proofs } = buildMerkleFromLeaves([leaf]);
    expect(computeRootFromProof({ leaf, proof: proofs[0] })).toBe(root);
  });
});
