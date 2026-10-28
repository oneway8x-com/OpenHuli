import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    name: "voice",
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts"],
    exclude: ["**/*.integration.test.ts"],
  },
});
