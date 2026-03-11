import { defineConfig } from "vitest/config";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: { "@": __dirname },
  },
  test: {
    name: "web-lib",
    environment: "node",
    include: ["lib/**/*.test.ts"],
  },
});
