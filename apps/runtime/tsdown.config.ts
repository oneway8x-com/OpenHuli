import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/main.ts", "src/serial-bridge/main.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  external: ["@prisma/client"],
  noExternal: [/^@corely\/modules-/],
});
