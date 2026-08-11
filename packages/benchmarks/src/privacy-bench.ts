/**
 * Client-side cost of the selective-disclosure extension (thesis ch. 6).
 *
 * Measures, for a batch of N diplomas:
 *   - envelope size on the wire (standard vs private, per disclosure subset)
 *   - issuer-side cost of building the commitments
 *   - verifier-side cost of checking a private envelope end to end
 *
 * Run: npm -w @univerify/benchmarks run bench:privacy
 */
import {
  buildMerkleFromLeaves,
  computeMerkleLeaf,
  computePrivateDocHash,
  computeRootFromProof,
  computeFieldCommitments,
  generateFieldSalts,
  hashPayload,
  verifyDisclosedFields,
  type DiplomaPayload,
  type DisclosedFields,
} from "@univerify/verifier-core";
import type { Address, Hex } from "viem";

const N = 1000;
const REPS = 2000;
const REGISTRY = "0x1111111111111111111111111111111111111111" as Address;
const ISSUER = "0x2222222222222222222222222222222222222222" as Address;
const CHAIN_ID = 8453n;
const BATCH_ID = 1n;

function payloadFor(i: number): DiplomaPayload {
  return {
    universityId: "pw-eiti",
    student: { firstName: "Jan", lastName: "Kowalski", studentId: `s${300000 + i}` },
    degree: { name: "Bachelor of Computer Science", level: "BSc" },
    issuedAt: "2025-06-30",
    diplomaNumber: `UV-2025-${String(i).padStart(6, "0")}`,
  } as DiplomaPayload;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function timeMedian(fn: () => void): number {
  for (let i = 0; i < 200; i++) fn(); // warm-up
  const samples: number[] = [];
  for (let i = 0; i < REPS; i++) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }
  return median(samples);
}

const bytes = (o: unknown) => Buffer.byteLength(JSON.stringify(o), "utf8");

// --- batch of N private diplomas -------------------------------------------
const payloads = Array.from({ length: N }, (_, i) => payloadFor(i));
const salts = payloads.map(() => generateFieldSalts());
const commitments = payloads.map((p, i) => computeFieldCommitments(p, salts[i]));
const privateLeaves: Hex[] = commitments.map((c) =>
  computeMerkleLeaf({
    registry: REGISTRY,
    chainId: CHAIN_ID,
    issuer: ISSUER,
    batchId: BATCH_ID,
    docHash: computePrivateDocHash(c),
  }),
);
const { root, proofs } = buildMerkleFromLeaves(privateLeaves);

const standardLeaves: Hex[] = payloads.map((p) =>
  computeMerkleLeaf({
    registry: REGISTRY,
    chainId: CHAIN_ID,
    issuer: ISSUER,
    batchId: BATCH_ID,
    docHash: hashPayload(p),
  }),
);
const standardTree = buildMerkleFromLeaves(standardLeaves);

// --- envelope sizes ---------------------------------------------------------
const k = 0; // reference diploma
const proofPart = { type: "MERKLE_BATCH", issuer: ISSUER, batchId: "1", path: proofs[k] };

const standardEnvelope = { payload: payloads[k], proof: { ...proofPart, path: standardTree.proofs[k] } };

function privateEnvelope(fields: readonly (keyof DisclosedFields)[]) {
  const disclosed: DisclosedFields = {};
  for (const f of fields) {
    (disclosed as Record<string, unknown>)[f] = {
      value: (payloads[k] as Record<string, unknown>)[f],
      salt: (salts[k] as Record<string, Hex>)[f],
    };
  }
  return { commitments: commitments[k], disclosed, proof: proofPart };
}

const subsets: Array<[string, (keyof DisclosedFields)[]]> = [
  ["degree", ["degree"]],
  ["student+degree", ["student", "degree"]],
  ["wszystkie 4", ["student", "degree", "issuedAt", "diplomaNumber"]],
];

// --- timings ----------------------------------------------------------------
const tIssue = timeMedian(() => {
  const s = generateFieldSalts();
  const c = computeFieldCommitments(payloads[k], s);
  computePrivateDocHash(c);
});

const tStandardHash = timeMedian(() => {
  hashPayload(payloads[k]);
});

const verifyOne = (fields: (keyof DisclosedFields)[]) => {
  const env = privateEnvelope(fields);
  return () => {
    verifyDisclosedFields(env.disclosed, env.commitments);
    const leaf = computeMerkleLeaf({
      registry: REGISTRY,
      chainId: CHAIN_ID,
      issuer: ISSUER,
      batchId: BATCH_ID,
      docHash: computePrivateDocHash(env.commitments),
    });
    computeRootFromProof({ leaf, proof: proofs[k] });
  };
};

const tVerifyStandard = timeMedian(() => {
  const leaf = computeMerkleLeaf({
    registry: REGISTRY,
    chainId: CHAIN_ID,
    issuer: ISSUER,
    batchId: BATCH_ID,
    docHash: hashPayload(payloads[k]),
  });
  computeRootFromProof({ leaf, proof: standardTree.proofs[k] });
});

const tBuildBatch = (() => {
  const t0 = performance.now();
  const s = payloads.map(() => generateFieldSalts());
  const c = payloads.map((p, i) => computeFieldCommitments(p, s[i]));
  const l = c.map((ci) =>
    computeMerkleLeaf({
      registry: REGISTRY,
      chainId: CHAIN_ID,
      issuer: ISSUER,
      batchId: BATCH_ID,
      docHash: computePrivateDocHash(ci),
    }),
  );
  buildMerkleFromLeaves(l);
  return performance.now() - t0;
})();

// --- report -----------------------------------------------------------------
console.log(`N=${N}, głębokość dowodu=${proofs[k].length}, korzeń=${root.slice(0, 10)}…`);
console.log(`\nRozmiar koperty [B] (JSON, UTF-8):`);
console.log(`  standardowa (pełny payload)      ${bytes(standardEnvelope)}`);
for (const [name, fields] of subsets) {
  console.log(`  prywatna, ujawnione: ${name.padEnd(16)} ${bytes(privateEnvelope(fields))}`);
}
console.log(`\nCzas [ms] (mediana z ${REPS} powtórzeń):`);
console.log(`  wystawienie: skrót standardowy    ${tStandardHash.toFixed(4)}`);
console.log(`  wystawienie: sole+zobowiązania    ${tIssue.toFixed(4)}`);
console.log(`  weryfikacja standardowa           ${tVerifyStandard.toFixed(4)}`);
for (const [name, fields] of subsets) {
  console.log(`  weryfikacja prywatna: ${name.padEnd(15)} ${timeMedian(verifyOne(fields)).toFixed(4)}`);
}
console.log(`\nBudowa całej partii prywatnej (N=${N}): ${tBuildBatch.toFixed(1)} ms`);
console.log(`node ${process.version}`);
