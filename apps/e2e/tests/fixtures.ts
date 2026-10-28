import { test as base, expect, type APIRequestContext } from "@playwright/test";
import { PrismaService } from "@corely/data";
import {
  bootstrapOwner,
  IdentityRepository,
  readAuthConfig,
  requestOwnerCode,
} from "@corely/modules-identity";
import { getTestDatabaseUrl } from "../../../scripts/test-database";

export interface TestTenant {
  tenantId: string;
  email: string;
  code: string;
  storageState: Awaited<ReturnType<APIRequestContext["storageState"]>>;
}
export const test = base.extend<{ session: TestTenant }>({
  session: async ({ playwright }, use) => {
    if (process.env.DATABASE_URL !== getTestDatabaseUrl())
      throw new Error("E2E database target mismatch");
    const prisma = new PrismaService(),
      repository = new IdentityRepository(prisma);
    const config = readAuthConfig({ ...process.env, NODE_ENV: "test" });
    const owner = await bootstrapOwner(config, repository);
    const api = await playwright.request.newContext({
      baseURL: config.origin,
      extraHTTPHeaders: { origin: config.origin },
    });
    try {
      let code = "";
      await requestOwnerCode(
        owner.email,
        config,
        repository,
        async (_email, value) => {
          code = value;
        },
      );
      const response = await api.post("/api/auth/verify-code", {
        data: { email: owner.email, code },
      });
      expect(response.status(), await response.text()).toBe(200);
      const storageState = await api.storageState();
      // A local delivery port captures a second OTP for the UI login journey. No public test endpoint.
      await prisma.portalOtpCode.deleteMany({
        where: { tenantId: owner.tenantId, emailNormalized: owner.email },
      });
      await requestOwnerCode(
        owner.email,
        config,
        repository,
        async (_email, value) => {
          code = value;
        },
      );
      await use({
        tenantId: owner.tenantId,
        email: owner.email,
        code,
        storageState,
      });
    } finally {
      await api.dispose();
      await prisma.portalOtpCode.deleteMany({
        where: { tenantId: owner.tenantId, emailNormalized: owner.email },
      });
      await prisma.agentRun.deleteMany({ where: { tenantId: owner.tenantId } });
      await prisma.device.deleteMany({ where: { tenantId: owner.tenantId } });
      await prisma.user.deleteMany({ where: { id: owner.userId } });
      await prisma.tenant.deleteMany({ where: { id: owner.tenantId } });
      await prisma.disconnect();
    }
  },
  storageState: async ({ session }, use) => {
    await use(session.storageState);
  },
});
export { expect };
