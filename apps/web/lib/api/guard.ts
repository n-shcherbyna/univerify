import { type NextRequest, type NextResponse } from "next/server";
import { checkApiKey } from "./apiKey";
import { checkRateLimit } from "./rateLimit";

/**
 * Run API key auth + rate limiting.
 * Returns a NextResponse error if blocked, or null if the request should proceed.
 */
export function apiGuard(request: NextRequest): NextResponse | null {
  return checkApiKey(request) ?? checkRateLimit(request);
}
