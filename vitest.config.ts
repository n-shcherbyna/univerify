import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      "packages/verifier-core/vitest.config.ts",
      "apps/web/vitest.config.ts",
      "packages/benchmarks/vitest.config.ts",
    ],
  },
});
