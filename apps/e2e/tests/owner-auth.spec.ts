import { expect, test } from "./fixtures";

test("owner signs in with an OTP and signs out with server-side revocation", async ({
  page,
  request,
  session,
}, testInfo) => {
  await page.context().clearCookies();
  await page.goto("/todos");
  await expect(page).toHaveURL(/\/login$/);
  await expect(
    page.getByRole("heading", { name: "Welcome to OpenHuli" }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("owner-login.png"),
    fullPage: true,
  });
  await page.getByLabel("Email address").fill(session.email);
  await page.getByRole("button", { name: "Continue with email" }).click();
  await page.getByLabel("6-digit code").fill(session.code);
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await expect(page).toHaveURL(/\/todos$/);
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.find((cookie) => cookie.name === "openhuli_access")?.httpOnly,
  ).toBe(true);
  expect(
    await page.evaluate(() => localStorage.getItem("accessToken")),
  ).toBeNull();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("owner-mobile.png"),
    fullPage: true,
  });
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  // The original API context still holds the fixture session: revoke it explicitly and verify cookie replay is rejected.
  const staleAccess = session.storageState.cookies.find(
    (cookie) => cookie.name === "openhuli_access",
  )?.value;
  const logout = await request.post("/api/auth/logout", { data: {} });
  expect(logout.status()).toBe(204);
  expect(
    (
      await request.get("/api/todos", {
        headers: { authorization: `Bearer ${staleAccess}` },
      })
    ).status(),
  ).toBe(401);
  await page.goto("/todos");
  await expect(page).toHaveURL(/\/login$/);
});

test("browser sessions reject CSRF, spoofed tenants, and malformed bearer overrides", async ({
  request,
}) => {
  expect((await request.get("/api/todos")).status()).toBe(200);
  expect(
    (
      await request.post("/api/todos", {
        headers: { origin: "https://attacker.example.test" },
        data: { title: "forbidden" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/api/todos", {
        headers: { "x-tenant-id": "other-tenant" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/api/todos", {
        headers: { authorization: "Bearer broken" },
      })
    ).status(),
  ).toBe(401);
});
