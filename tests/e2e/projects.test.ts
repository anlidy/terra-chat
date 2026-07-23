import { expect } from "@playwright/test";
import { test } from "../fixtures";

test.describe("Projects", () => {
  test("creates a project and a nested project chat", async ({ page }) => {
    await page.goto("/");

    await page
      .locator('[data-sidebar="sidebar"]')
      .getByTestId("sidebar-toggle-button")
      .click();
    await page.getByRole("button", { name: "Create project" }).click();
    const projectName = `Atlas research ${Date.now()}`;
    await page.getByRole("textbox", { name: "Project name" }).fill(projectName);
    await page
      .getByRole("button", { name: "Create project", exact: true })
      .click();

    await expect(page).toHaveURL(/\/projects\/[\w-]+/);
    await expect(
      page.getByRole("heading", { name: projectName })
    ).toBeVisible();
    await expect(page.getByText("No project chats yet")).toBeVisible();

    await page.getByRole("button", { name: "Create first chat" }).click();
    await expect(page).toHaveURL(/\/chat\/[\w-]+/);
    await expect(
      page.locator("main").getByRole("link", { name: projectName })
    ).toBeVisible();
    await expect(
      page
        .locator("main")
        .getByRole("link", { name: projectName })
        .getByText("0 searchable files")
    ).toBeVisible();
  });
});
