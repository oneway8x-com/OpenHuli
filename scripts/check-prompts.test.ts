import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

test("prompt guard checks new files and tolerates deleted tracked files", () => {
  const root = mkdtempSync(path.join(tmpdir(), "openhuli-prompts-"));
  const script = fileURLToPath(new URL("./check-prompts.mjs", import.meta.url));
  const property = ["pro", "mpt"].join("");
  try {
    assert.equal(
      spawnSync("git", ["init", "--quiet"], { cwd: root }).status,
      0,
    );
    writeFileSync(path.join(root, "deleted.ts"), "export const value = 1;\n");
    assert.equal(
      spawnSync("git", ["add", "deleted.ts"], { cwd: root }).status,
      0,
    );
    unlinkSync(path.join(root, "deleted.ts"));
    writeFileSync(
      path.join(root, "new.ts"),
      `export const config = { ${property}: "inline instruction" };\n`,
    );
    const failed = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /new.ts/);
    assert.doesNotMatch(failed.stderr, /ENOENT/);
    unlinkSync(path.join(root, "new.ts"));
    mkdirSync(path.join(root, "packages/prompts"), { recursive: true });
    writeFileSync(
      path.join(root, "packages/prompts/example.ts"),
      `export const config = { ${property}: "owned instruction" };\n`,
    );
    const passed = spawnSync(process.execPath, [script], {
      cwd: root,
      encoding: "utf8",
    });
    assert.equal(passed.status, 0, passed.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
