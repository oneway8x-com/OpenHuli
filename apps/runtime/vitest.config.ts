import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@corely/modules-voice": fileURLToPath(
        new URL("../../packages/modules/voice/src/index.ts", import.meta.url),
      ),
      "@corely/modules-devices": fileURLToPath(
        new URL("../../packages/modules/devices/src/index.ts", import.meta.url),
      ),
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
    exclude: ["**/*.integration.test.ts"],
    testTimeout: 10_000,
  },
});
