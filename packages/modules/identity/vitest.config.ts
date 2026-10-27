import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "identity",
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts"],
  },
});
