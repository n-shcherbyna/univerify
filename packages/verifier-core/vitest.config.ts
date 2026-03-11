import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "verifier-core",
    include: ["src/**/*.test.ts"],
  },
});
