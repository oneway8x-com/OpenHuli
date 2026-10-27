import { randomUUID } from "node:crypto";
import { test as base, expect } from "@playwright/test";
import { PrismaService } from "@corely/data";
import { getTestDatabaseUrl } from "../../../scripts/test-database";

export interface TestTenant {
  tenantId: string;
}

export const test = base.extend<{ session: TestTenant }>({
  // Playwright requires destructured fixture arguments even when this fixture needs no others.
  // eslint-disable-next-line no-empty-pattern
  session: async ({}, use) => {
    // Persistence fixture only: never provision accounts through a public test endpoint.
    const databaseUrl = getTestDatabaseUrl();
    if (process.env.DATABASE_URL !== databaseUrl)
      throw new Error("E2E database target mismatch");
    const prisma = new PrismaService();
    const tenantId = `e2e-${randomUUID()}`;
    try {
      await prisma.tenant.create({
        data: { id: tenantId, slug: tenantId, name: "E2E maker" },
      });
      await use({ tenantId });
    } finally {
      await prisma.todo.deleteMany({ where: { tenantId } });
      await prisma.tenant.deleteMany({ where: { id: tenantId } });
      await prisma.disconnect();
    }
  },
  extraHTTPHeaders: async ({ session }, use) => {
    // Characterizes the development scaffold; this is not an authentication test.
    await use({ "x-tenant-id": session.tenantId });
  },
});
export { expect };
