import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { z } from "zod";
const run = promisify(execFile);
const cwd = fileURLToPath(new URL("../../../../", import.meta.url));
const secret = "synthetic-private-value-not-for-output";
const env = {
  ...process.env,
  TEST_DATABASE_URL: `postgresql://user:${secret}@remote.example.test/openhuli_test`,
  GEMINI_API_KEY: secret,
  TSX_TSCONFIG_PATH: fileURLToPath(
    new URL("../../tsconfig.test.json", import.meta.url),
  ),
};
it("documents modes without constructing a database or provider", async () => {
  const result = await run(
    process.execPath,
    ["--import", "tsx", "apps/runtime/src/simulator/main.ts", "--help"],
    { cwd, env },
  );
  expect(result.stdout).toContain("--mock");
  expect(result.stdout).toContain("--live");
  expect(result.stdout).not.toContain("PrismaService");
  expect(result.stdout + result.stderr).not.toContain(secret);
});
it("rejects a nonlocal mock database before persistence, without exposing configuration", async () => {
  const result = await run(
    process.execPath,
    ["--import", "tsx", "apps/runtime/src/simulator/main.ts", "--mock"],
    { cwd, env },
  ).then(
    () => {
      throw new Error("Unsafe mock unexpectedly started");
    },
    (error: unknown) =>
      z
        .object({ code: z.number(), stdout: z.string(), stderr: z.string() })
        .parse(error),
  );
  expect(result.code).toBe(1);
  expect(result.stderr).toContain("No live success established");
  expect(result.stdout).not.toContain("PrismaService");
  expect(result.stdout + result.stderr).not.toContain(secret);
  expect(result.stdout + result.stderr).not.toContain("remote.example.test");
});
