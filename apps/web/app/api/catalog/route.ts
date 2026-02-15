import { promises as fs } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { hashPayload } from "@univerify/verifier-core";
import { isHex, type Hex } from "viem";

export const runtime = "nodejs";

type CatalogEntry = {
  universityId: number;
  officialName: string;
  metadataHash: Hex;
};

type CatalogSnapshot = {
  universities: CatalogEntry[];
};

const CATALOG_PATH = path.join(process.cwd(), "public", "catalog.snapshot.json");

function assertCatalogShape(value: unknown): CatalogSnapshot {
  const v = value as any;
  if (!v || typeof v !== "object" || !Array.isArray(v.universities)) {
    throw new Error("Catalog must be an object with universities array.");
  }

  for (const u of v.universities) {
    if (!Number.isInteger(u?.universityId) || u.universityId <= 0) {
      throw new Error("Each university must have positive integer universityId.");
    }
    if (typeof u?.officialName !== "string" || u.officialName.trim() === "") {
      throw new Error("Each university must have officialName.");
    }
    if (typeof u?.metadataHash !== "string" || !isHex(u.metadataHash, { strict: true }) || u.metadataHash.length !== 66) {
      throw new Error("Each university must have metadataHash bytes32.");
    }
  }

  return v as CatalogSnapshot;
}

async function readCatalog(): Promise<CatalogSnapshot> {
  try {
    const raw = await fs.readFile(CATALOG_PATH, "utf8");
    return assertCatalogShape(JSON.parse(raw));
  } catch {
    return { universities: [] };
  }
}

async function writeCatalog(snapshot: CatalogSnapshot): Promise<void> {
  const body = `${JSON.stringify(snapshot, null, 2)}\n`;
  await fs.writeFile(CATALOG_PATH, body, "utf8");
}

export async function GET() {
  try {
    const snapshot = await readCatalog();
    const snapshotHash = hashPayload(snapshot) as Hex;
    return NextResponse.json({
      snapshot,
      snapshotHash,
      universitiesCount: snapshot.universities.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Cannot read catalog." }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = (await req.json()) as Partial<CatalogEntry>;
    if (!Number.isInteger(body.universityId) || (body.universityId ?? 0) <= 0) {
      return NextResponse.json({ error: "universityId must be positive integer." }, { status: 400 });
    }
    if (typeof body.officialName !== "string" || body.officialName.trim() === "") {
      return NextResponse.json({ error: "officialName is required." }, { status: 400 });
    }
    if (
      typeof body.metadataHash !== "string" ||
      !isHex(body.metadataHash, { strict: true }) ||
      body.metadataHash.length !== 66
    ) {
      return NextResponse.json({ error: "metadataHash must be bytes32 hex." }, { status: 400 });
    }

    const snapshot = await readCatalog();
    const universityId = body.universityId as number;
    const nextEntry: CatalogEntry = {
      universityId,
      officialName: body.officialName.trim(),
      metadataHash: body.metadataHash as Hex,
    };

    const index = snapshot.universities.findIndex((u) => u.universityId === nextEntry.universityId);
    if (index >= 0) snapshot.universities[index] = nextEntry;
    else snapshot.universities.push(nextEntry);

    snapshot.universities.sort((a, b) => a.universityId - b.universityId);
    const normalized = assertCatalogShape(snapshot);
    await writeCatalog(normalized);

    const snapshotHash = hashPayload(normalized) as Hex;
    return NextResponse.json({
      ok: true,
      snapshot: normalized,
      snapshotHash,
      universitiesCount: normalized.universities.length,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Cannot update catalog." }, { status: 500 });
  }
}
