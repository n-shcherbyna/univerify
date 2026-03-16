import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { checkRateLimit } from "./rateLimit";

function makeRequest(ip = "127.0.0.1"): NextRequest {
  return new NextRequest("http://localhost:3000/api/verify", {
    method: "POST",
    headers: { "x-forwarded-for": ip },
  });
}

describe("checkRateLimit", () => {
  it("allows requests under the limit", () => {
    // Use a unique IP to avoid interference from other tests
    const ip = `10.0.0.${Math.floor(Math.random() * 255)}`;
    for (let i = 0; i < 30; i++) {
      const result = checkRateLimit(makeRequest(ip));
      expect(result).toBeNull();
    }
  });

  it("blocks the 31st request within the window", () => {
    const ip = `10.1.0.${Math.floor(Math.random() * 255)}`;
    for (let i = 0; i < 30; i++) {
      checkRateLimit(makeRequest(ip));
    }
    const result = checkRateLimit(makeRequest(ip));
    expect(result).not.toBeNull();
    expect(result!.status).toBe(429);
  });

  it("returns Retry-After header on 429", async () => {
    const ip = `10.2.0.${Math.floor(Math.random() * 255)}`;
    for (let i = 0; i < 31; i++) {
      checkRateLimit(makeRequest(ip));
    }
    const result = checkRateLimit(makeRequest(ip))!;
    expect(result.headers.get("Retry-After")).toBeTruthy();
    expect(result.headers.get("X-RateLimit-Remaining")).toBe("0");
  });

  it("different IPs have independent limits", () => {
    const ipA = `10.3.0.${Math.floor(Math.random() * 255)}`;
    const ipB = `10.4.0.${Math.floor(Math.random() * 255)}`;
    for (let i = 0; i < 30; i++) {
      checkRateLimit(makeRequest(ipA));
    }
    // ipA is at limit, ipB should still be fine
    const resultB = checkRateLimit(makeRequest(ipB));
    expect(resultB).toBeNull();
  });
});
