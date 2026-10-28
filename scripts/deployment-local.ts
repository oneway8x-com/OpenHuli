import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

/** Disposable local trust only. Never overwrites an existing operator directory. */
export function createLocalDeployment(directory: string) {
  const root = resolve(directory);
  mkdirSync(root, { mode: 0o700 });
  for (const name of ["secrets", "tls"])
    mkdirSync(join(root, name), { mode: 0o700 });
  for (const name of [
    "postgres_password",
    "jwt_secret",
    "mqtt_password",
    "mqtt_auth_token",
    "notes_api_token",
  ])
    writeFileSync(
      join(root, "secrets", name),
      randomBytes(32).toString("hex"),
      { mode: 0o444 },
    );
  // Empty keys deliberately keep paid provider work disabled. Configure email delivery before login.
  for (const name of ["gemini_api_key", "email_api_key"])
    writeFileSync(join(root, "secrets", name), "", { mode: 0o444 });
  const openssl = (args: string[]) =>
    execFileSync("openssl", args, {
      cwd: join(root, "tls"),
      stdio: "ignore",
      timeout: 30000,
    });
  openssl([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-days",
    "2",
    "-keyout",
    "ca.key",
    "-out",
    "ca.crt",
    "-subj",
    "/CN=OpenHuli disposable local CA",
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  ]);
  openssl([
    "req",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-sha256",
    "-keyout",
    "server.key",
    "-out",
    "server.csr",
    "-subj",
    "/CN=openhuli.localhost",
  ]);
  writeFileSync(
    join(root, "tls", "extensions.cnf"),
    "basicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:openhuli.localhost,DNS:runtime.openhuli.localhost,DNS:mqtt.openhuli.localhost\n",
  );
  openssl([
    "x509",
    "-req",
    "-in",
    "server.csr",
    "-CA",
    "ca.crt",
    "-CAkey",
    "ca.key",
    "-CAcreateserial",
    "-out",
    "server.crt",
    "-days",
    "2",
    "-sha256",
    "-extfile",
    "extensions.cnf",
  ]);
  // Parent directory is 0700. Individual read-only files must be readable by mounted service UIDs.
  execFileSync("chmod", [
    "444",
    join(root, "tls", "server.key"),
    join(root, "tls", "server.crt"),
    join(root, "tls", "ca.crt"),
  ]);
  execFileSync("chmod", ["600", join(root, "tls", "ca.key")]);
  const template = readFileSync(
    new URL("../docker/deploy/stack.env.example", import.meta.url),
    "utf8",
  );
  writeFileSync(
    join(root, "stack.env"),
    template
      .replace("./deployment.local/secrets", join(root, "secrets"))
      .replace("./deployment.local/tls", join(root, "tls")),
    { mode: 0o600 },
  );
  return root;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    createLocalDeployment(process.argv[2] ?? "deployment.local");
    console.log(
      "Created local secrets and two-day TLS certificates. Configure email delivery and follow docs/guides/DOCKER_DEPLOYMENT.md.",
    );
  } catch {
    console.error(
      "Local deployment setup failed; the output directory must be new and OpenSSL must be available. Inspect partial output before retrying.",
    );
    process.exitCode = 1;
  }
}
