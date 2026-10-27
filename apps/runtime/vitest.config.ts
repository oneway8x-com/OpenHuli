import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@corely/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "runtime",
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    restoreMocks: true,
    testTimeout: 10_000,
  },
});
