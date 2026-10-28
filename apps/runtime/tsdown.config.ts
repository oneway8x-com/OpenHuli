import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: [
    "@corely/modules-voice",
    "@corely/modules-devices",
    "@corely/modules-conversations",
    "@corely/modules-tool-execution",
    "@corely/modules-identity",
  ],
});
