import {
  createPublicClient,
  http,
  type Address,
  type Chain,
  type Hex,
  type PublicClient,
  type Transport,
} from "viem";
import {
  DiplomaRegistryAbi,
  DiplomaPayloadSchema,
  hashPayload,
  computeMerkleLeaf,
  computeRootFromProof,
  computePrivateDocHash,
  verifyDisclosedFields,
  type StatusCode,
  type DiplomaPayload,
  type FieldCommitments,
  type DisclosedFields,
} from "@univerify/verifier-core";

// ─── Public types ────────────────────────────────────────────────────────────

export type SdkConfig = {
  rpcUrl: string;
  registryAddress: Address;
  chainId: number;
  /** Block number from which to scan events. Defaults to 0. */
  deployBlock?: bigint;
};

export type DiplomaEnvelope = {
  payload: DiplomaPayload;
  proof: {
    type: "MERKLE_BATCH";
    batchId: number;
    proof: Hex[];
    issuer: Address;
  };
};

export type VerifyResult = {
  verified: boolean;
  status: { code: StatusCode; label: string };
  docHash: Hex;
  issuer: { address: Address; trusted: boolean; universityId: string };
  batchId: number;
  revoked: boolean;
  merkle: {
    leaf: Hex;
    computedRoot: Hex;
    onChainRoot: Hex;
    rootMatches: boolean;
  };
  university: UniversityInfo | null;
  diploma: DiplomaPayload | null;
};

export type StatusResult = {
  status: { code: StatusCode; label: string };
  docHash: Hex;
  issuer: Address;
  batchId: number;
  revoked: boolean;
  merkle: {
    leaf: Hex;
    computedRoot: Hex;
    onChainRoot: Hex;
    rootMatches: boolean;
  };
};

export type UniversityInfo = {
  name: string;
  country: string;
  website: string;
  accreditationId: string;
  status: number;
};

export type IssuerInfo = {
  address: Address;
  universityId: bigint;
  active: boolean;
};

export type BatchInfo = {
  issuer: Address;
  batchId: bigint;
  merkleRoot: Hex;
};

export type PrivateDiplomaEnvelope = {
  commitments: FieldCommitments;
  disclosed: DisclosedFields;
  proof: {
    type: "MERKLE_BATCH";
    batchId: number;
    proof: Hex[];
    issuer: Address;
  };
};

export type SelectiveVerifyResult = {
  verified: boolean;
  status: { code: StatusCode; label: string };
  docHash: Hex;
  issuer: { address: Address; trusted: boolean; universityId: string };
  batchId: number;
  revoked: boolean;
  merkle: {
    leaf: Hex;
    computedRoot: Hex;
    onChainRoot: Hex;
    rootMatches: boolean;
  };
  university: UniversityInfo | null;
  disclosedFieldsValid: boolean;
  disclosedData: DisclosedFields;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusLabel(code: StatusCode): string {
  if (code === 0) return "Unknown";
  if (code === 1) return "Valid";
  return "Revoked";
}

// ─── Client ──────────────────────────────────────────────────────────────────

export class UniverifySdk {
  readonly registry: Address;
  readonly chainId: number;
  readonly deployBlock: bigint;
  private readonly client: PublicClient<Transport, Chain | undefined>;

  constructor(config: SdkConfig) {
    this.registry = config.registryAddress;
    this.chainId = config.chainId;
    this.deployBlock = config.deployBlock ?? 0n;
    this.client = createPublicClient({ transport: http(config.rpcUrl) });
  }

  // ── Full verification ────────────────────────────────────────────────────

  async verify(envelope: DiplomaEnvelope): Promise<VerifyResult> {
    const docHash = hashPayload(envelope.payload);
    const { issuer, batchId: batchIdNum, proof } = envelope.proof;
    const batchId = BigInt(batchIdNum);

    const [statusCode, merkleRoot, issuerTrusted, issuerUniversityId, revoked] =
      await Promise.all([
        this.readStatusWithProof(docHash, issuer, batchId, proof),
        this.readBatchRoot(issuer, batchId),
        this.readIsIssuer(issuer),
        this.readIssuerUniversityId(issuer),
        this.readIsRevoked(docHash, issuer, batchId),
      ]);

    const leaf = computeMerkleLeaf({
      registry: this.registry,
      chainId: BigInt(this.chainId),
      issuer,
      batchId,
      docHash,
    });
    const computedRoot = computeRootFromProof({ leaf, proof });
    const rootMatches = computedRoot.toLowerCase() === merkleRoot.toLowerCase();

    const university =
      issuerUniversityId > 0n
        ? await this.getUniversity(issuerUniversityId)
        : null;

    const universityActive = university?.status === 1;
    const verified = statusCode === 1 && rootMatches && universityActive;

    const parsed = DiplomaPayloadSchema.safeParse(envelope.payload);

    return {
      verified,
      status: { code: statusCode, label: statusLabel(statusCode) },
      docHash,
      issuer: {
        address: issuer,
        trusted: issuerTrusted,
        universityId: issuerUniversityId.toString(),
      },
      batchId: batchIdNum,
      revoked,
      merkle: { leaf, computedRoot, onChainRoot: merkleRoot, rootMatches },
      university,
      diploma: parsed.success ? parsed.data : null,
    };
  }

  // ── Selective disclosure verification ────────────────────────────────────

  async selectiveVerify(envelope: PrivateDiplomaEnvelope): Promise<SelectiveVerifyResult> {
    const disclosedFieldsValid = verifyDisclosedFields(envelope.disclosed, envelope.commitments);
    const docHash = computePrivateDocHash(envelope.commitments);
    const { issuer, batchId: batchIdNum, proof } = envelope.proof;
    const batchId = BigInt(batchIdNum);

    const [statusCode, merkleRoot, issuerTrusted, issuerUniversityId, revoked] =
      await Promise.all([
        this.readStatusWithProof(docHash, issuer, batchId, proof),
        this.readBatchRoot(issuer, batchId),
        this.readIsIssuer(issuer),
        this.readIssuerUniversityId(issuer),
        this.readIsRevoked(docHash, issuer, batchId),
      ]);

    const leaf = computeMerkleLeaf({
      registry: this.registry,
      chainId: BigInt(this.chainId),
      issuer,
      batchId,
      docHash,
    });
    const computedRoot = computeRootFromProof({ leaf, proof });
    const rootMatches = computedRoot.toLowerCase() === merkleRoot.toLowerCase();

    const university = issuerUniversityId > 0n
      ? await this.getUniversity(issuerUniversityId)
      : null;

    const universityActive = university?.status === 1;
    const verified = disclosedFieldsValid && statusCode === 1 && rootMatches && universityActive;

    return {
      verified,
      status: { code: statusCode, label: statusLabel(statusCode) },
      docHash,
      issuer: { address: issuer, trusted: issuerTrusted, universityId: issuerUniversityId.toString() },
      batchId: batchIdNum,
      revoked,
      merkle: { leaf, computedRoot, onChainRoot: merkleRoot, rootMatches },
      university,
      disclosedFieldsValid,
      disclosedData: envelope.disclosed,
    };
  }

  // ── Lightweight status check ─────────────────────────────────────────────

  async status(
    docHash: Hex,
    issuer: Address,
    batchId: bigint,
    proof: readonly Hex[],
  ): Promise<StatusResult> {
    const [statusCode, merkleRoot, revoked] = await Promise.all([
      this.readStatusWithProof(docHash, issuer, batchId, proof),
      this.readBatchRoot(issuer, batchId),
      this.readIsRevoked(docHash, issuer, batchId),
    ]);

    const leaf = computeMerkleLeaf({
      registry: this.registry,
      chainId: BigInt(this.chainId),
      issuer,
      batchId,
      docHash,
    });
    const computedRoot = computeRootFromProof({ leaf, proof });
    const rootMatches = computedRoot.toLowerCase() === merkleRoot.toLowerCase();

    return {
      status: { code: statusCode, label: statusLabel(statusCode) },
      docHash,
      issuer,
      batchId: Number(batchId),
      revoked,
      merkle: { leaf, computedRoot, onChainRoot: merkleRoot, rootMatches },
    };
  }

  // ── Registry queries ─────────────────────────────────────────────────────

  async getBatch(issuer: Address, batchId: bigint): Promise<BatchInfo> {
    const merkleRoot = await this.readBatchRoot(issuer, batchId);
    return { issuer, batchId, merkleRoot };
  }

  async getIssuer(issuer: Address): Promise<IssuerInfo> {
    const universityId = await this.readIssuerUniversityId(issuer);
    return { address: issuer, universityId, active: universityId > 0n };
  }

  async getUniversity(universityId: bigint): Promise<UniversityInfo | null> {
    const logs = await this.client.getLogs({
      address: this.registry,
      event: {
        type: "event",
        name: "UniversitySet",
        inputs: [
          { name: "universityId", type: "uint64", indexed: true },
          { name: "status", type: "uint8", indexed: true },
          { name: "name", type: "string", indexed: false },
          { name: "country", type: "string", indexed: false },
          { name: "website", type: "string", indexed: false },
          { name: "accreditationId", type: "string", indexed: false },
        ],
      },
      args: { universityId },
      fromBlock: this.deployBlock,
      toBlock: "latest",
    });

    if (logs.length === 0) return null;
    const latest = logs[logs.length - 1].args as any;
    return {
      name: latest.name ?? "",
      country: latest.country ?? "",
      website: latest.website ?? "",
      accreditationId: latest.accreditationId ?? "",
      status: Number(latest.status ?? 0),
    };
  }

  async getOwner(): Promise<Address> {
    return (await this.client.readContract({
      address: this.registry,
      abi: DiplomaRegistryAbi,
      functionName: "owner",
      args: [],
    })) as Address;
  }

  async getPendingOwner(): Promise<Address> {
    return (await this.client.readContract({
      address: this.registry,
      abi: DiplomaRegistryAbi,
      functionName: "pendingOwner",
      args: [],
    })) as Address;
  }

  // ── Internal contract reads ──────────────────────────────────────────────

  private async readStatusWithProof(
    docHash: Hex,
    issuer: Address,
    batchId: bigint,
    proof: readonly Hex[],
  ): Promise<StatusCode> {
    return (await this.client.readContract({
      address: this.registry,
      abi: DiplomaRegistryAbi,
      functionName: "statusWithProof",
      args: [docHash, issuer, batchId, proof],
    })) as StatusCode;
  }

  private async readBatchRoot(issuer: Address, batchId: bigint): Promise<Hex> {
    return (await this.client.readContract({
      address: this.registry,
      abi: DiplomaRegistryAbi,
      functionName: "getBatch",
      args: [issuer, batchId],
    })) as Hex;
  }

  private async readIsIssuer(issuer: Address): Promise<boolean> {
    return (await this.client.readContract({
      address: this.registry,
      abi: DiplomaRegistryAbi,
      functionName: "isIssuer",
      args: [issuer],
    })) as boolean;
  }

  private async readIssuerUniversityId(issuer: Address): Promise<bigint> {
    return (await this.client.readContract({
      address: this.registry,
      abi: DiplomaRegistryAbi,
      functionName: "issuerUniversityId",
      args: [issuer],
    })) as bigint;
  }

  private async readIsRevoked(
    docHash: Hex,
    issuer: Address,
    batchId: bigint,
  ): Promise<boolean> {
    return (await this.client.readContract({
      address: this.registry,
      abi: DiplomaRegistryAbi,
      functionName: "isRevoked",
      args: [docHash, issuer, batchId],
    })) as boolean;
  }
}
