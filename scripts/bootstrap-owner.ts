import {
  bootstrapOwner,
  readAuthConfig,
} from "../packages/modules/identity/src/index";
import { getIdentityStore } from "../apps/app/src/server/identity-runtime";
import { getPrisma } from "../apps/app/src/server/prisma";

// An operator CLI, never a public endpoint. Check the effective database before running.
const config = readAuthConfig({
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || "development",
});
if (config.development) {
  const url = new URL(process.env.DATABASE_URL || "");
  if (
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !["/openhuli", "/openhuli_test"].includes(url.pathname) ||
    url.search ||
    url.hash
  )
    throw new Error("Development bootstrap requires a local OpenHuli database");
}
try {
  const owner = await bootstrapOwner(config, getIdentityStore());
  console.log(
    `Owner is ready for tenant ${owner.tenantId}. Sign in using the configured owner email.`,
  );
} finally {
  await getPrisma().$disconnect();
  await globalThis.__corelyPrismaPool?.end();
}
