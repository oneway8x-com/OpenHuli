import { createTodo } from "./helpers/todo-fixtures";
import { gotoTodos } from "./helpers/auth";
import { expect, test } from "./fixtures";

test.describe("development todo request flow", () => {
  test("creates a task through the UI and persists it through the API", async ({
    page,
    request,
  }, testInfo) => {
    await gotoTodos(page);
    await expect(
      page.getByText("No tasks found.", { exact: false }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await page
      .getByLabel("Title", { exact: true })
      .fill("Connect the weather station");
    await page
      .getByLabel("Description", { exact: true })
      .fill("Verify the local setup");
    await page.getByRole("combobox", { name: "Priority" }).click();
    await page.getByRole("option", { name: "High", exact: true }).click();
    await page
      .getByRole("button", { name: "Create task", exact: true })
      .click();
    await expect(page).toHaveURL(/\/todos\/[0-9a-f-]{36}$/);
    await expect(
      page.getByText("Connect the weather station", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Verify the local setup", { exact: true }),
    ).toBeVisible();
    const response = await request.get("/api/todos");
    expect(response.ok()).toBe(true);
    expect(await response.json()).toMatchObject({
      items: [{ title: "Connect the weather station", priority: "high" }],
    });
    await page.reload();
    await expect(
      page.getByText("Connect the weather station", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("openhuli-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("openhuli-mobile.png"),
      fullPage: true,
    });
  });

  test("completes and reopens a task", async ({ page, request }) => {
    const todo = await createTodo(request, "Verify the microphone");
    await gotoTodos(page);
    await page
      .getByLabel("Mark Verify the microphone as complete", { exact: true })
      .click();
    await expect(
      page.getByLabel("Reopen Verify the microphone", { exact: true }),
    ).toBeVisible();
    expect(
      await (await request.get(`/api/todos/${todo.id}`)).json(),
    ).toMatchObject({ status: "done" });
    await page
      .getByLabel("Reopen Verify the microphone", { exact: true })
      .click();
    await expect(
      page.getByLabel("Mark Verify the microphone as complete", {
        exact: true,
      }),
    ).toBeVisible();
    expect(
      await (await request.get(`/api/todos/${todo.id}`)).json(),
    ).toMatchObject({ status: "open" });
  });

  test("edits and deletes a task", async ({ page, request }) => {
    const todo = await createTodo(request, "Check the sensor");
    await gotoTodos(page);
    const row = page.getByRole("row").filter({ hasText: "Check the sensor" });
    await row.getByRole("link", { name: "Edit", exact: true }).click();
    await page.getByLabel("Title", { exact: true }).fill("Sensor verified");
    await page
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(
      page.getByText("Sensor verified", { exact: true }),
    ).toBeVisible();
    await gotoTodos(page);
    page.once("dialog", (dialog) => dialog.accept());
    await page.getByLabel("Delete Sensor verified", { exact: true }).click();
    await expect(
      page.getByRole("link", { name: "Sensor verified", exact: true }),
    ).toHaveCount(0);
    expect((await request.get(`/api/todos/${todo.id}`)).status()).toBe(404);
  });
});
