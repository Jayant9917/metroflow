import { expect, test } from "@playwright/test";

const adminEmail = process.env.METROFLOW_ADMIN_EMAIL ?? "admin@metroflow.dev";
const adminPassword = process.env.METROFLOW_ADMIN_PASSWORD ?? "MetroFlow-Admin-123!";

test.describe("responsive browser coverage", () => {
  test("public login shell fits the viewport", async ({ page }) => {
    await page.goto("/login");
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });

  test("authenticated admin shell fits the viewport", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(adminEmail);
    await page.locator("#password").fill(adminPassword);
    await page.getByRole("button", { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/admin/);
    await expect(page.getByText(/access/i).first()).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(overflow).toBe(false);
  });
});
