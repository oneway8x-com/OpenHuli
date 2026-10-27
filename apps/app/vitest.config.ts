import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@corely/modules-devices": fileURLToPath(
        new URL("../../packages/modules/devices/src/index.ts", import.meta.url),
      ),
      "@corely/modules-identity": fileURLToPath(
        new URL(
          "../../packages/modules/identity/src/index.ts",
          import.meta.url,
        ),
      ),
      "@corely/modules-todos": fileURLToPath(
        new URL("../../packages/modules/todos/src/index.ts", import.meta.url),
      ),
      "@corely/contracts": fileURLToPath(
        new URL("../../packages/contracts/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    name: "app",
    environment: "node",
    include: ["src/**/__tests__/**/*.{spec,test}.ts"],
    restoreMocks: true,
    exclude: ["**/*.integration.test.ts"],
    env: {
      JWT_SECRET: "synthetic-unit-secret-at-least-32-characters",
      OWNER_EMAIL: "owner@example.test",
      APP_URL: "http://localhost:3000",
    },
  },
});
