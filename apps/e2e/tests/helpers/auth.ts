import { expect, type Page } from "@playwright/test";

/** The fixture signs in through the real owner OTP/session handlers. */
export async function gotoTodos(page: Page): Promise<void> {
  await page.goto("/todos");
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
}
