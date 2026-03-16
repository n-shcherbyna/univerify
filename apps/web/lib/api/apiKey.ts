import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional API key authentication.
 *
 * When `UNIVERIFY_API_KEYS` env var is set (comma-separated list of keys),
 * requests must include a valid key via `Authorization: Bearer <key>` or
 * `X-API-Key: <key>` header.
 *
 * When `UNIVERIFY_API_KEYS` is not set, all requests are allowed (open mode).
 *
 * Returns a 401 response if authentication fails, or null if the request is allowed.
 */
export function checkApiKey(request: NextRequest): NextResponse | null {
  const raw = process.env.UNIVERIFY_API_KEYS;
  if (!raw) return null; // Open mode — no auth required

  const validKeys = new Set(
    raw.split(",").map((k) => k.trim()).filter(Boolean)
  );
  if (validKeys.size === 0) return null;

  const bearer = request.headers.get("authorization");
  if (bearer) {
    const token = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : "";
    if (validKeys.has(token)) return null;
  }

  const apiKeyHeader = request.headers.get("x-api-key");
  if (apiKeyHeader && validKeys.has(apiKeyHeader.trim())) return null;

  return NextResponse.json(
    { error: "Invalid or missing API key" },
    { status: 401 }
  );
}
