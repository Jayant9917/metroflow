import { expect, test } from "@playwright/test";

const adminEmail = process.env.METROFLOW_ADMIN_EMAIL ?? "admin@metroflow.dev";
const adminPassword = process.env.METROFLOW_ADMIN_PASSWORD ?? "MetroFlow-Admin-123!";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.describe("authenticated operations access", () => {
  test("admin can open the protected operations dashboard", async ({ page }) => {
    await loginAsAdmin(page);
    await expect(page.getByRole("heading", { name: /operations overview|administration overview/i })).toBeVisible();
    await expect(page.getByText(/administrator access|admin access/i)).toBeVisible();
  });

  test("admin can open the ticket operations table with current data state", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: /ticket operations/i })).toBeVisible();
    await expect(page.locator("table, .admin-notice").first()).toBeVisible();
  });

  test("logged-out users are redirected from journey history", async ({ page }) => {
    await page.goto("/journeys");
    await expect(page).toHaveURL(/\/login/);
  });
});
