import { mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
const State = z
  .object({
    version: z.literal(1),
    deviceId: z.string().min(1).max(64),
    until: z.number().int().min(0).max(4102444799999),
  })
  .strict();
/** Exclusive process lock and atomic durable expiry watermark, never an execution replay queue. */
export async function openFence(path: string, deviceId: string) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lock = await open(path + ".lock", "wx", 0o600);
  let until = 0;
  try {
    try {
      const handle = await open(path, "r");
      try {
        const info = await handle.stat();
        if (
          info.size > 1024 ||
          !info.isFile() ||
          (process.platform !== "win32" && info.mode & 0o077)
        )
          throw new Error("Invalid fence file");
        const state = State.parse(JSON.parse(await handle.readFile("utf8")));
        if (state.deviceId !== deviceId)
          throw new Error("Fence device mismatch");
        until = state.until;
      } finally {
        await handle.close();
      }
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "ENOENT")
      )
        throw error;
    }
  } catch (error) {
    await lock.close();
    await unlink(path + ".lock");
    throw error;
  }
  let closed = false;
  return {
    until,
    async reserve(expires: number) {
      if (
        closed ||
        !Number.isSafeInteger(expires) ||
        expires <= 0 ||
        expires >= 4102444800000
      )
        throw new Error("Invalid dispatch fence");
      if (expires <= until) return;
      const next = path + ".next";
      const file = await open(next, "w", 0o600);
      try {
        await file.chmod(0o600);
        await file.writeFile(
          JSON.stringify({ version: 1, deviceId, until: expires }),
        );
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(next, path);
      if (process.platform !== "win32") {
        const dir = await open(dirname(path), "r");
        try {
          await dir.sync();
        } finally {
          await dir.close();
        }
      }
      until = expires;
    },
    async close() {
      if (!closed) {
        closed = true;
        await lock.close();
        await unlink(path + ".lock");
      }
    },
  };
}
