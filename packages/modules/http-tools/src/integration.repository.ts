import type { PrismaClient } from "@prisma/client";
import { createHash } from "node:crypto";
import type { IntegrationSettings } from "@corely/contracts";

/** The existing integration table stores public configuration only; secrets stay server-side. */
export class HttpIntegrationRepository {
  constructor(private readonly db: PrismaClient) {}
  private id(tenantId: string) {
    return `openhuli-http-${createHash("sha256").update(tenantId).digest("hex")}`;
  }
  async get(tenantId: string): Promise<unknown> {
    const row = await this.db.integrationConnection.findFirst({
      where: { id: this.id(tenantId), tenantId, providerKey: "openhuli-http" },
      select: { configJson: true },
    });
    return row?.configJson;
  }
  async save(tenantId: string, settings: IntegrationSettings) {
    await this.db.integrationConnection.upsert({
      where: { id: this.id(tenantId), tenantId },
      create: {
        id: this.id(tenantId),
        tenantId,
        providerKey: "openhuli-http",
        authMethod: "server",
        configJson: settings,
      },
      update: { configJson: settings },
    });
  }
}
