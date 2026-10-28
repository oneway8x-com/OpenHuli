import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

// Explicit allowlist: never print secret contents or load arbitrary environment-file paths.
const secrets = [
  "JWT_SECRET",
  "RESEND_API_KEY",
  "GEMINI_API_KEY",
  "RUNTIME_MQTT_PASSWORD",
  "RUNTIME_MQTT_AUTH_TOKEN",
  "NOTES_API_TOKEN",
];
try {
  for (const key of secrets) {
    const file = process.env[`${key}_FILE`];
    if (!file) continue;
    const value = readFileSync(file, "utf8").trim();
    if (value.length > 4096) throw new Error();
    process.env[key] = value;
  }
  const password = readFileSync(
    process.env.POSTGRES_PASSWORD_FILE || "/run/secrets/postgres_password",
    "utf8",
  ).trim();
  if (!/^[A-Za-z0-9_-]{32,128}$/.test(password)) throw new Error();
  process.env.DATABASE_URL = `postgresql://openhuli:${password}@postgres:5432/openhuli`;
  process.env.DIRECT_DATABASE_URL = process.env.DATABASE_URL;
} catch {
  console.error("Deployment secret files are missing or invalid");
  process.exit(1);
}
const roles = {
  app: [
    "node",
    [
      "apps/app/node_modules/next/dist/bin/next",
      "start",
      "apps/app",
      "-H",
      "0.0.0.0",
      "-p",
      "3000",
    ],
  ],
  runtime: ["node", ["apps/runtime/dist/main.mjs"]],
  migrate: ["pnpm", ["prisma:deploy"]],
  bootstrap: ["pnpm", ["owner:bootstrap"]],
};
const role = process.argv[2];
if (!Object.hasOwn(roles, role)) {
  console.error("Unknown deployment role");
  process.exit(1);
}
const [command, args] = roles[role];
const child = spawn(command, args, { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("Deployment process unavailable");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
