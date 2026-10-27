import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
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
  },
});
