import { test, expect } from "./fixtures";
import { PrismaService } from "@corely/data";
import { randomUUID } from "node:crypto";
import {
  DeviceAccessRepository,
  deviceMqttIdentity,
} from "../../../packages/modules/devices/src/index";
import {
  TelemetryRepository,
  ingestBrokerMessage,
} from "../../../packages/modules/telemetry/src/index";
import type { Page } from "@playwright/test";
async function seedReadings(deviceId: string, tenantId: string, stale = false) {
  const db = new PrismaService();
  try {
    const devices = new DeviceAccessRepository(db);
    const credential = (await devices.credentials(tenantId, deviceId)).find(
      (c) => c.purpose === "mqtt" && !c.revokedAt,
    );
    if (!credential) throw new Error("No MQTT credential");
    const deps = {
      devices,
      store: new TelemetryRepository(db),
      epoch: "a5e7e480-7d99-4e84-ae48-02b939097819",
      policy: { intervalSeconds: 30, retentionDays: 7 },
    };
    const identity = deviceMqttIdentity({
      tenantId,
      deviceId,
      credentialId: credential.id,
    });
    const sampledAt = new Date(Date.now() - (stale ? 120000 : 0)).toISOString();
    await ingestBrokerMessage(
      {
        identity,
        topic: `openhuli/v1/devices/${deviceId}/telemetry`,
        retained: false,
        payload: JSON.stringify({
          version: 1,
          type: "device.telemetry",
          messageId: randomUUID(),
          deviceId,
          bootId: "device-console-test",
          sequence: stale ? 0 : 1,
          sampledAt,
          readings: [
            { metric: "temperature", value: 21.5, unit: "degC" },
            { metric: "humidity", value: 45, unit: "percent" },
          ],
        }),
      },
      deps,
    );
  } finally {
    await db.disconnect();
  }
}
async function pair(page: Page, display = true) {
  await page.goto("/devices");
  await page
    .getByLabel("Device name", { exact: true })
    .fill("Managed weather device");
  await page.getByLabel("Room", { exact: true }).fill("Lab");
  if (display) await page.getByLabel("Has a display").check();
  await page.getByRole("button", { name: "Pair device", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Save your device configuration" }),
  ).toBeVisible();
  const id = new URL(page.url()).searchParams.get("id");
  if (!id) throw new Error("No device id");
  const configuration = await page
    .getByLabel("One-time device configuration")
    .textContent();
  await page.getByRole("button", { name: "Hide credentials" }).click();
  return { id, configuration };
}
test("owner pairs, reads stale/fresh telemetry, approves one command and revokes a credential", async ({
  page,
  session,
}) => {
  const f = await pair(page);
  const dto = await (await page.request.get(`/api/devices/${f.id}`)).text();
  expect(dto).not.toContain('"token"');
  expect(dto).not.toContain("secretHash");
  await seedReadings(f.id, session.tenantId, true);
  await expect(
    page.getByText("Readings: stale", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("21.5 °C", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("img", {
      name: "temperature measurements over the last 24 hours",
    }),
  ).toBeVisible();
  await seedReadings(f.id, session.tenantId);
  await expect(
    page.getByText("Readings: fresh", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Presence: online", { exact: true }),
  ).toBeVisible();
  await page.getByLabel("Display text", { exact: true }).fill("Hello lab");
  await page.getByRole("button", { name: "Send to display" }).click();
  await expect(
    page.getByRole("button", { name: "Approve command" }),
  ).toBeVisible();
  await expect(
    page.getByText('"text": "Hello lab"', { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Approve command" }).click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  const db = new PrismaService();
  try {
    expect(
      await db.deviceCommand.count({
        where: { tenantId: session.tenantId, deviceId: f.id },
      }),
    ).toBe(1);
  } finally {
    await db.disconnect();
  }
  await page
    .getByLabel("Grant expiry")
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Save grant", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Revoke grant device_context" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Revoke grant device_context" })
    .click();
  await expect(
    page.getByText("device_context · Revoked", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Rotate mqtt", exact: true }).click();
  await expect(page.getByLabel("One-time device configuration")).toBeVisible();
  expect(
    await page.getByLabel("One-time device configuration").textContent(),
  ).not.toBe(f.configuration);
  await page.getByRole("button", { name: "Hide credentials" }).click();
  await page.getByRole("button", { name: "Revoke mqtt", exact: true }).click();
  await page
    .getByRole("button", { name: "Confirm revocation", exact: true })
    .click();
  await expect(
    page.getByText("Credential revoked.", { exact: true }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/openhuli19-devices-desktop.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/openhuli19-devices-mobile.png",
    fullPage: true,
  });
});
test("integration settings persist without secrets and notes connection probe creates no note", async ({
  page,
}) => {
  await page.goto("/devices");
  await expect(
    page.getByRole("heading", { name: "Integrations", exact: true }),
  ).toBeVisible();
  await page.getByLabel("Forecast latitude", { exact: true }).fill("52.52");
  await page.getByLabel("Forecast longitude", { exact: true }).fill("13.41");
  await page.getByRole("button", { name: "Save integration settings" }).click();
  await expect(
    page.getByText("Integration settings saved.", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Test forecast connection" }).click();
  await expect(
    page.getByText(
      "Forecast GET returned validated data. No note was created.",
      { exact: true },
    ),
  ).toBeVisible();
  await page.getByRole("button", { name: "Test notes connection" }).click();
  await expect(
    page.getByText(
      "Notes authenticated health check succeeded. No note was created.",
      { exact: true },
    ),
  ).toBeVisible();
  const response = await page.request.get("/api/device-management");
  const content = await response.text();
  expect(content).not.toContain("secretReference");
  expect(content).not.toContain("console-fixture");
  expect(content).not.toContain("synthetic-console-notes-token");
  await page.getByLabel("Enable forecast", { exact: true }).uncheck();
  await page.getByRole("button", { name: "Save integration settings" }).click();
  await page.reload();
  await expect(
    page.getByLabel("Enable forecast", { exact: true }),
  ).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Test forecast connection" }),
  ).toBeDisabled();
  expect(
    (
      await page.request.post("/api/device-management", {
        data: { action: "test", toolId: "weather.forecast" },
      })
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.post("/api/device-management", {
        headers: { origin: "https://forged.example" },
        data: { action: "test", toolId: "notes.create" },
      })
    ).status(),
  ).toBe(403);
});
test("unsupported display is explicit; denial and unknown receipts never claim success", async ({
  page,
  session,
}) => {
  const f = await pair(page, false);
  await expect(
    page.getByText("Display commands are unsupported by this device."),
  ).toBeVisible();
  expect(
    (
      await page.request.post("/api/device-management", {
        data: {
          action: "command",
          deviceId: f.id,
          requestId: randomUUID(),
          toolId: "display.message",
          text: "Denied",
        },
      })
    ).status(),
  ).toBe(400);
  await seedReadings(f.id, session.tenantId);
  await page.getByRole("button", { name: "Ping device", exact: true }).click();
  await page.getByRole("button", { name: "Deny command", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  const db = new PrismaService();
  try {
    expect(
      await db.deviceCommand.count({
        where: { tenantId: session.tenantId, deviceId: f.id },
      }),
    ).toBe(0);
  } finally {
    await db.disconnect();
  }
  const g = await pair(page, true);
  await seedReadings(g.id, session.tenantId);
  await page
    .getByLabel("Display text", { exact: true })
    .fill("simulate unknown");
  await page.getByRole("button", { name: "Send to display" }).click();
  await page
    .getByRole("button", { name: "Approve command", exact: true })
    .click();
  await expect(
    page.getByText("Outcome unknown — check the device before retrying", {
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByText("Outcome unknown — check the device before retrying", {
      exact: true,
    }),
  ).toBeVisible();
  expect(await page.getByText("Confirmed", { exact: true }).count()).toBe(0);
});
test("a lost command receipt recovers by request identity after refresh without another submission", async ({
  page,
  session,
}) => {
  const { id } = await pair(page, false);
  await seedReadings(id, session.tenantId);
  let submitted = 0;
  await page.route("**/api/device-management", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postDataJSON()?.action === "command"
    ) {
      submitted++;
      const actual = await route.fetch();
      expect(actual.status()).toBe(202);
      await route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"error":"Synthetic lost receipt"}',
      });
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Ping device", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve command", exact: true }),
  ).toBeVisible();
  expect(new URL(page.url()).searchParams.get("request")).toBeTruthy();
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Approve command", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve command", exact: true })
    .click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  expect(submitted).toBe(1);
  const db = new PrismaService();
  try {
    expect(
      await db.deviceCommand.count({
        where: { tenantId: session.tenantId, deviceId: id },
      }),
    ).toBe(1);
  } finally {
    await db.disconnect();
  }
});
