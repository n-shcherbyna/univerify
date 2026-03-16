import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { checkApiKey } from "./apiKey";

function makeRequest(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost:3000/api/verify", {
    method: "POST",
    headers,
  });
}

describe("checkApiKey", () => {
  const originalEnv = process.env.UNIVERIFY_API_KEYS;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.UNIVERIFY_API_KEYS;
    } else {
      process.env.UNIVERIFY_API_KEYS = originalEnv;
    }
  });

  it("allows all requests when UNIVERIFY_API_KEYS is not set", () => {
    delete process.env.UNIVERIFY_API_KEYS;
    expect(checkApiKey(makeRequest())).toBeNull();
  });

  it("allows all requests when UNIVERIFY_API_KEYS is empty", () => {
    process.env.UNIVERIFY_API_KEYS = "";
    expect(checkApiKey(makeRequest())).toBeNull();
  });

  it("rejects requests with no key when API keys are configured", () => {
    process.env.UNIVERIFY_API_KEYS = "key-abc-123";
    const result = checkApiKey(makeRequest());
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("accepts valid Bearer token", () => {
    process.env.UNIVERIFY_API_KEYS = "key-abc-123";
    const result = checkApiKey(
      makeRequest({ authorization: "Bearer key-abc-123" })
    );
    expect(result).toBeNull();
  });

  it("accepts valid X-API-Key header", () => {
    process.env.UNIVERIFY_API_KEYS = "key-abc-123";
    const result = checkApiKey(
      makeRequest({ "x-api-key": "key-abc-123" })
    );
    expect(result).toBeNull();
  });

  it("rejects invalid Bearer token", () => {
    process.env.UNIVERIFY_API_KEYS = "key-abc-123";
    const result = checkApiKey(
      makeRequest({ authorization: "Bearer wrong-key" })
    );
    expect(result).not.toBeNull();
    expect(result!.status).toBe(401);
  });

  it("supports multiple comma-separated keys", () => {
    process.env.UNIVERIFY_API_KEYS = "key-1, key-2, key-3";
    expect(checkApiKey(makeRequest({ "x-api-key": "key-1" }))).toBeNull();
    expect(checkApiKey(makeRequest({ "x-api-key": "key-2" }))).toBeNull();
    expect(checkApiKey(makeRequest({ "x-api-key": "key-3" }))).toBeNull();
    expect(checkApiKey(makeRequest({ "x-api-key": "key-4" }))).not.toBeNull();
  });
});
