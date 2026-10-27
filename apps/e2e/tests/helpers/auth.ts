import { expect, type Page } from "@playwright/test";

/** The current development todo page has no owner-login gate; issue #3 adds it. */
export async function gotoTodos(page: Page): Promise<void> {
  await page.goto("/todos");
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
}
