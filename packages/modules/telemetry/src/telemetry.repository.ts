import { Prisma, type PrismaClient } from "@prisma/client";
import type { DevicePresence, DeviceTelemetry } from "@corely/contracts";
import type { DeviceSession } from "@corely/modules-devices";

export class TelemetryRepository {
  constructor(private readonly db: PrismaClient) {}
  private async transaction<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.db.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (
          !(error instanceof Prisma.PrismaClientKnownRequestError) ||
          error.code !== "P2034" ||
          attempt >= 4
        )
          throw error;
      }
    }
  }
  private async observe(
    tx: Prisma.TransactionClient,
    session: DeviceSession,
    input: {
      bootId: string;
      sequence: number;
      status: "online" | "offline";
      time: Date;
      kind: "telemetry" | "presence";
    },
    epoch: string,
    retained: boolean,
    now: Date,
  ) {
    const key = { tenantId: session.tenantId, deviceId: session.deviceId };
    const previous = await tx.devicePresence.findUnique({
      where: { tenantId_deviceId: key },
    });
    const sameBoot = previous?.bootId === input.bootId;
    if (previous && !sameBoot && input.time < previous.sampledAt) return;
    // MQTT delivery can lag behind the synchronous Will callback. A queued sample
    // must not resurrect an explicitly offline connection; reconnect publishes online presence.
    if (
      sameBoot &&
      previous?.status === "offline" &&
      input.kind === "telemetry"
    )
      return;
    const previousSequence = sameBoot
      ? input.kind === "telemetry"
        ? previous?.telemetrySequence
        : previous?.presenceSequence
      : null;
    if (
      previousSequence !== null &&
      previousSequence !== undefined &&
      BigInt(input.sequence) <= previousSequence
    )
      return;
    const hintOnly = retained && input.status === "online";
    // Retained online state may advance ordering metadata but cannot establish a live connection.
    const data = {
      bootId: input.bootId,
      backendEpoch: hintOnly
        ? (previous?.backendEpoch ?? "unconfirmed")
        : epoch,
      status: hintOnly ? "unknown" : input.status,
      lastSeenAt: hintOnly ? (previous?.lastSeenAt ?? new Date(0)) : now,
      sampledAt:
        previous && sameBoot && previous.sampledAt > input.time
          ? previous.sampledAt
          : input.time,
      telemetrySequence:
        input.kind === "telemetry"
          ? BigInt(input.sequence)
          : sameBoot
            ? (previous?.telemetrySequence ?? null)
            : null,
      presenceSequence:
        input.kind === "presence"
          ? BigInt(input.sequence)
          : sameBoot
            ? (previous?.presenceSequence ?? null)
            : null,
    };
    await tx.devicePresence.upsert({
      where: { tenantId_deviceId: key },
      create: { ...key, ...data },
      update: data,
    });
  }
  async sample(
    session: DeviceSession,
    input: DeviceTelemetry,
    epoch: string,
    retained: boolean,
    now: Date,
  ) {
    return this.transaction(async (tx) => {
      const result = await tx.deviceTelemetry.createMany({
        data: [
          {
            tenantId: session.tenantId,
            deviceId: session.deviceId,
            messageId: input.messageId,
            bootId: input.bootId,
            sequence: BigInt(input.sequence),
            sampledAt: new Date(input.sampledAt),
            receivedAt: now,
            readingsJson: JSON.stringify(input.readings),
            sensorErrorsJson: JSON.stringify(input.sensorErrors ?? []),
          },
        ],
        skipDuplicates: true,
      });
      if (result.count && !retained)
        await this.observe(
          tx,
          session,
          {
            bootId: input.bootId,
            sequence: input.sequence,
            status: "online",
            time: new Date(input.sampledAt),
            kind: "telemetry",
          },
          epoch,
          false,
          now,
        );
      return result.count === 1;
    });
  }
  presence(
    session: DeviceSession,
    input: DevicePresence,
    epoch: string,
    retained: boolean,
    now: Date,
  ) {
    return this.transaction((tx) =>
      this.observe(
        tx,
        session,
        {
          bootId: input.bootId,
          sequence: input.sequence,
          status: input.status,
          time: new Date(input.sentAt),
          kind: "presence",
        },
        epoch,
        retained,
        now,
      ),
    );
  }
  snapshot(tenantId: string, deviceId: string) {
    return this.db.devicePresence.findUnique({
      where: { tenantId_deviceId: { tenantId, deviceId } },
    });
  }
  latest(tenantId: string, deviceId: string, since?: Date) {
    return this.db.deviceTelemetry.findFirst({
      where: {
        tenantId,
        deviceId,
        ...(since ? { sampledAt: { gte: since } } : {}),
      },
      orderBy: [{ sampledAt: "desc" }, { receivedAt: "desc" }, { id: "desc" }],
    });
  }
  history(
    tenantId: string,
    deviceId: string,
    from: Date,
    to: Date,
    take: number,
  ) {
    return this.db.deviceTelemetry.findMany({
      where: { tenantId, deviceId, sampledAt: { gte: from, lte: to } },
      orderBy: [{ sampledAt: "desc" }, { id: "desc" }],
      take,
    });
  }
  cleanup(tenantId: string, before: Date) {
    return this.db.deviceTelemetry.deleteMany({
      where: { tenantId, sampledAt: { lt: before } },
    });
  }
  /** Server maintenance enumerates only Tenant IDs; every resource deletion remains tenant-scoped. */
  tenantsForCleanup(after?: string) {
    return this.db.tenant.findMany({
      where: after ? { id: { gt: after } } : {},
      select: { id: true },
      orderBy: { id: "asc" },
      take: 100,
    });
  }
}
