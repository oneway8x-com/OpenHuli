import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";

// Exercise Next's production SWC config loader in plain Node, without tsx's resolver hooks.
// The container failure occurred despite successful builds and browser tests using tsx.
const loader = `
  import path from "node:path";
  import { createRequire } from "node:module";
  const require = createRequire(import.meta.url);
  const { transpileConfig } = require("./apps/app/node_modules/next/dist/build/next-config-ts/transpile-config.js");
  const cwd = path.resolve("apps/app");
  const loaded = await transpileConfig({ nextConfigPath: path.join(cwd, "next.config.ts"), configFileName: "next.config.ts", cwd });
  loaded.default(process.env.CONFIG_TEST_PHASE);
  console.log("loaded");
`;
function load(phase: string, env: NodeJS.ProcessEnv = {}) {
  return execFileSync(process.execPath, ["--input-type=module", "-e", loader], {
    encoding: "utf8",
    stdio: "pipe",
    timeout: 10000,
    env: {
      ...process.env,
      NODE_OPTIONS: "",
      NODE_ENV: "production",
      JWT_SECRET: "synthetic-production-config-secret-at-least-32-characters",
      OWNER_EMAIL: "owner@example.test",
      EMAIL_FROM: "owner@example.test",
      RESEND_API_KEY: "synthetic-unused-key",
      APP_URL: "https://openhuli.example.test",
      CONFIG_TEST_PHASE: phase,
      ...env,
    },
  });
}
test("production startup loads the shared auth config without TypeScript resolver hooks", () => {
  assert.equal(load("phase-production-server").trim(), "loaded");
});
test("production config loading still enforces signing-secret validation", () => {
  assert.throws(
    () => load("phase-production-server", { JWT_SECRET: "" }),
    /JWT_SECRET must be/,
  );
});
test("build config remains loadable without runtime credentials", () => {
  assert.equal(
    load("phase-production-build", {
      JWT_SECRET: "",
      OWNER_EMAIL: "",
      EMAIL_FROM: "",
      RESEND_API_KEY: "",
      APP_URL: "",
    }).trim(),
    "loaded",
  );
});
