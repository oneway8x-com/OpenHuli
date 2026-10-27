import { config } from "dotenv";
import { PrismaService } from "./prisma.service";

config({ path: "../../.env" });
const url = new URL(process.env.DATABASE_URL ?? "");
if (
  !["postgres:", "postgresql:"].includes(url.protocol) ||
  !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
  url.pathname !== "/openhuli" ||
  url.hash ||
  [...url.searchParams].some(
    ([key, value]) => key !== "schema" || value !== "public",
  )
) {
  throw new Error(
    "Local seed requires the local openhuli development database",
  );
}
const tenantId = process.env.CORELY_DEV_TENANT_ID || "dev-tenant";
const prisma = new PrismaService();
try {
  await prisma.tenant.upsert({
    where: { id: tenantId },
    update: {},
    create: {
      id: tenantId,
      name: "OpenHuli local development",
      slug: tenantId,
    },
  });
  console.log(
    "Local development tenant is ready. This does not configure owner authentication.",
  );
} finally {
  await prisma.disconnect();
}
