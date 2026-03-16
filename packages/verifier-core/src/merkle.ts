import { encodePacked, keccak256, type Address, type Hex } from "viem";

function hashPair(a: Hex, b: Hex): Hex {
  return a.toLowerCase() < b.toLowerCase()
    ? keccak256(encodePacked(["bytes32", "bytes32"], [a, b]))
    : keccak256(encodePacked(["bytes32", "bytes32"], [b, a]));
}

export function computeMerkleLeaf(params: {
  registry: Address;
  chainId: bigint;
  issuer: Address;
  batchId: bigint;
  docHash: Hex;
}): Hex {
  return keccak256(
    encodePacked(
      ["address", "uint256", "address", "uint64", "bytes32"],
      [params.registry, params.chainId, params.issuer, params.batchId, params.docHash]
    )
  );
}

export function buildMerkleFromLeaves(leaves: readonly Hex[]): {
  root: Hex;
  proofs: Hex[][];
} {
  if (leaves.length === 0) {
    throw new Error("Cannot build Merkle tree from empty leaf list.");
  }

  const levels: Hex[][] = [Array.from(leaves)];
  while (levels[levels.length - 1].length > 1) {
    const current = levels[levels.length - 1];
    const next: Hex[] = [];
    for (let i = 0; i < current.length; i += 2) {
      const left = current[i];
      const right = i + 1 < current.length ? current[i + 1] : current[i];
      next.push(hashPair(left, right));
    }
    levels.push(next);
  }

  const proofs: Hex[][] = leaves.map(() => []);
  for (let leafIndex = 0; leafIndex < leaves.length; leafIndex++) {
    let idx = leafIndex;
    for (let level = 0; level < levels.length - 1; level++) {
      const arr = levels[level];
      const sibIdx = idx ^ 1;
      const sibling = sibIdx < arr.length ? arr[sibIdx] : arr[idx];
      proofs[leafIndex].push(sibling);
      idx = Math.floor(idx / 2);
    }
  }

  return { root: levels[levels.length - 1][0], proofs };
}

export function computeRootFromProof(params: {
  leaf: Hex;
  proof: readonly Hex[];
}): Hex {
  let computed = params.leaf;
  for (const sibling of params.proof) {
    computed = hashPair(computed, sibling);
  }
  return computed;
}
