import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";
async function prepare(page: Page) {
  const paired = await page.request.post("/api/devices", {
    data: {
      name: "Console lab device",
      room: "Lab",
      profileId: "weather-station",
      profileVersion: 1,
      capabilities: [
        { kind: "temperature" },
        { kind: "humidity" },
        { kind: "ping" },
      ],
    },
  });
  expect(paired.status()).toBe(201);
  await page.goto("/conversations");
  await expect(
    page.getByRole("heading", { name: "Talk to your devices" }),
  ).toBeVisible();
  await page
    .getByLabel("Active device")
    .selectOption({ label: "Console lab device · Lab" });
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
}
async function send(page: Page, text: string) {
  await page.getByLabel("Message", { exact: true }).fill(text);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Approve action", exact: true }),
  ).toBeVisible();
}
test("typed turns require exact approval, expose authoritative results, and refresh without replay", async ({
  page,
}) => {
  await prepare(page);
  await send(page, "success");
  await expect(page.getByText('"mode": "success"')).toBeVisible();
  await expect(page.getByText("Needs approval", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "/tmp/openhuli18-console-approval.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Approve action", exact: true })
    .click();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Everything succeeded! <script>alert('unsafe')</script>", {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.locator("script").filter({ hasText: "alert('unsafe')" }),
  ).toHaveCount(0);
  await page
    .getByText("Result, sources and timestamps", { exact: true })
    .click();
  await expect(page.getByText('"source": "synthetic fixture"')).toBeVisible();
  await expect(page.getByText('"effects": 1')).toBeVisible();
  await expect(page.getByText("must-not-appear-in-console")).toHaveCount(0);
  const conversationURL = page.url();
  await page.reload();
  await expect(
    page.getByText("Transcript retention is off.", { exact: false }),
  ).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Everything succeeded! <script>alert('unsafe')</script>", {
      exact: false,
    }),
  ).toHaveCount(0);
  await page
    .getByText("Result, sources and timestamps", { exact: true })
    .click();
  await expect(page.getByText('"effects": 1')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("heading", { name: "Talk to your devices" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/openhuli18-console-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/openhuli18-console-desktop.png",
    fullPage: true,
  });
  expect(page.url()).toBe(conversationURL);
});
test("denial, partial and unknown results never become confirmed from assistant language", async ({
  page,
}) => {
  await prepare(page);
  await send(page, "success");
  await page.getByRole("button", { name: "Deny action", exact: true }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(
    page.getByText("Everything succeeded!", { exact: false }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  const deniedURL = page.url();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page).not.toHaveURL(deniedURL);
  const deniedId = new URL(deniedURL).searchParams.get("id");
  expect(
    (await (await page.request.get(`/api/conversations?id=${deniedId}`)).json())
      .live,
  ).toBe(false);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await send(page, "partial");
  await page
    .getByRole("button", { name: "Approve action", exact: true })
    .click();
  await expect(page.getByText("Partial result", { exact: true })).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  const partialURL = page.url();
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page).not.toHaveURL(partialURL);
  const partialId = new URL(partialURL).searchParams.get("id");
  expect(
    (
      await (
        await page.request.get(`/api/conversations?id=${partialId}`)
      ).json()
    ).live,
  ).toBe(false);
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await send(page, "unknown");
  await page
    .getByRole("button", { name: "Approve action", exact: true })
    .click();
  await expect(
    page.getByText("Outcome unknown", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("The action may have happened.", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByText("Everything succeeded!", { exact: false }),
  ).toHaveCount(0);
});
test("stopping a pending turn cancels its action and leaves the session read only", async ({
  page,
}) => {
  await prepare(page);
  await send(page, "success");
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByText("Read only", { exact: true })).toBeVisible();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Approve action", exact: true }),
  ).toHaveCount(0);
});
test("console routes require an owner and reject forged origins or tenant selection", async ({
  page,
  playwright,
}) => {
  const anonymous = await playwright.request.newContext({
    baseURL: "http://127.0.0.1:3100",
    storageState: { cookies: [], origins: [] },
  });
  try {
    expect((await anonymous.get("/api/conversations")).status()).toBe(401);
  } finally {
    await anonymous.dispose();
  }
  expect(
    (
      await page.request.post("/api/conversations", {
        headers: { Origin: "http://attacker.invalid" },
        data: { action: "create", deviceId: "forged" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get("/api/conversations", {
        headers: { "x-tenant-id": "forged" },
      })
    ).status(),
  ).toBe(403);
});
test("forecast and note turns use the registered HTTP tools with attribution and one confirmed POST", async ({
  page,
}) => {
  expect(
    (
      await page.request.post("/api/devices", {
        data: {
          name: "HTTP console device",
          profileId: "weather-station",
          profileVersion: 1,
          capabilities: [
            { kind: "temperature" },
            { kind: "humidity" },
            { kind: "ping" },
          ],
        },
      })
    ).status(),
  ).toBe(201);
  await page.goto("/conversations");
  await page
    .getByLabel("Active device")
    .selectOption({ label: "HTTP console device" });
  await page
    .getByRole("button", { name: "New conversation", exact: true })
    .click();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await page.getByLabel("Message", { exact: true }).fill("forecast");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Get forecast", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open-Meteo.com", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "CC BY 4.0", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Confirmed", { exact: true })).toBeVisible();
  await page
    .getByText("Result, sources and timestamps", { exact: true })
    .click();
  await expect(
    page.getByText('"attribution": "Weather data by Open-Meteo.com"'),
  ).toBeVisible();
  await expect(page.getByText('"fetchedAt":', { exact: false })).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toBeEnabled();
  await send(page, "A synthetic console note");
  await expect(
    page.getByText('"text": "A synthetic console note"'),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve action", exact: true })
    .click();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(2);
  const response = await page.request.get(
    `/api/conversations?id=${new URL(page.url()).searchParams.get("id")}`,
  );
  const snapshot = await response.json();
  const note = snapshot.executions.find(
    (execution: { toolId: string }) => execution.toolId === "notes.create",
  );
  expect(note.output.text).toBe("A synthetic console note");
  expect(note.output.id).toBeTruthy();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: "/tmp/openhuli18-console-http.png",
    fullPage: true,
  });
  await page.reload();
  await expect(page.getByText("Confirmed", { exact: true })).toHaveCount(2);
  const restored = await (
    await page.request.get(`/api/conversations?id=${snapshot.id}`)
  ).json();
  expect(
    restored.executions.filter(
      (execution: { toolId: string }) => execution.toolId === "notes.create",
    ),
  ).toHaveLength(1);
  expect(JSON.stringify(restored)).not.toContain(
    "synthetic-console-notes-token",
  );
});
