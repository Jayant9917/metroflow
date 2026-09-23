import { expect, test } from "@playwright/test";

const adminEmail = process.env.METROFLOW_ADMIN_EMAIL ?? "admin@metroflow.dev";
const adminPassword = process.env.METROFLOW_ADMIN_PASSWORD ?? "MetroFlow-Admin-123!";
const missingId = "00000000-0000-4000-8000-000000000000";

async function loginAsAdmin(page: import("@playwright/test").Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(adminEmail);
  await page.locator("#password").fill(adminPassword);
  await page.getByRole("button", { name: /sign in/i }).click();
  await expect(page).toHaveURL(/\/admin/);
}

test.describe("admin operations controls", () => {
  test("journeys, payments, and audit expose sorting controls", async ({ page }) => {
    await loginAsAdmin(page);
    for (const [path, label] of [["/admin/journeys", "Sort journeys"], ["/admin/payments", "Sort payments"], ["/admin/audit", "Sort audit events"]]) {
      await page.goto(path);
      await expect(page.getByLabel(label)).toBeVisible();
      await expect(page.getByRole("button", { name: /ascending|descending/i })).toBeVisible();
    }
  });

  test("record detail routes provide a safe empty state", async ({ page }) => {
    await loginAsAdmin(page);
    for (const [path, heading] of [
      [`/admin/tickets/${missingId}`, "Ticket detail"],
      [`/admin/journeys/${missingId}`, "Journey detail"],
      [`/admin/purchases/${missingId}`, "Purchase detail"],
      [`/admin/audit/${missingId}`, "Audit record detail"],
    ]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expect(page.getByText(/no record found|unable to load/i)).toBeVisible();
    }
  });
});
