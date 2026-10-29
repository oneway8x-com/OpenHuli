import { gotoTodos } from "./helpers/auth";
import { expect, test } from "./fixtures";

test("desktop navigation follows the selected feature and its nested pages", async ({
  page,
}) => {
  await gotoTodos(page);
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(
    navigation.getByRole("link", { name: "Todos", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Create task", exact: true }).click();
  await expect(page).toHaveURL(/\/todos\/new$/);
  await expect(
    navigation.getByRole("link", { name: "Todos", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await navigation.getByRole("link", { name: "Devices", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Connect your devices" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Devices", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    navigation.getByRole("link", { name: "Todos", exact: true }),
  ).not.toHaveAttribute("aria-current");
  await navigation
    .getByRole("link", { name: "Conversations", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Talk to your devices" }),
  ).toBeVisible();
  await expect(
    navigation.getByRole("link", { name: "Conversations", exact: true }),
  ).toHaveAttribute("aria-current", "page");
});

test("mobile navigation supports keyboard dismissal and closes after changing feature", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await gotoTodos(page);
  const trigger = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "OpenHuli navigation" });
  await trigger.click();
  await expect(drawer).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await drawer.getByRole("link", { name: "Devices", exact: true }).click();
  await expect(page).toHaveURL(/\/devices$/);
  await expect(drawer).toBeHidden();
  await expect(
    page.getByRole("heading", { name: "Connect your devices" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await trigger.click();
  await expect(
    drawer.getByRole("link", { name: "Devices", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await drawer.getByRole("link", { name: "Todos", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Tasks", exact: true }),
  ).toBeVisible();
  await expect(drawer).toBeHidden();
});
