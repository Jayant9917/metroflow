import { expect, test } from "@playwright/test";

test.describe("MetroFlow public passenger shell", () => {
  test("login page exposes an accessible password form", async ({ page }) => {
    await page.goto("/login");
    await expect(page).toHaveTitle(/MetroFlow/i);
    await expect(page.getByRole("heading", { name: /sign in/i })).toBeVisible();
    await expect(page.getByLabel("Email")).toHaveAttribute("name", "email");
    await expect(page.locator("#password")).toHaveAttribute("name", "password");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeEnabled();
  });

  test("new journey page has ordered station selectors", async ({ page }) => {
    await page.goto("/journey/new");
    await expect(page.getByRole("heading", { name: /plan your journey/i })).toBeVisible();
    await expect(page.locator("#origin-station")).toHaveAttribute("name", "originStationId");
    await expect(page.locator("#destination-station")).toHaveAttribute("name", "destinationStationId");
  });

  test("service health endpoints respond when the local stack is running", async ({ request }) => {
    const gateway = await request.get("http://localhost:3001/health");
    expect(gateway.ok()).toBeTruthy();
    expect(await gateway.json()).toEqual({ status: "ok", service: "api-gateway" });
  });
});
