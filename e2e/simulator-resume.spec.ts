import { expect, test } from "@playwright/test";

test.describe("journey simulator recovery", () => {
  test("can load the simulator route for an issued ticket", async ({ page }) => {
    test.skip(!process.env.E2E_TICKET_ID, "Set E2E_TICKET_ID with an authenticated Playwright state.");
    await page.goto(`/journey/simulator/${process.env.E2E_TICKET_ID}`);
    await expect(page.getByRole("heading", { name: /your metro journey|preparing your journey|unable to start simulator/i })).toBeVisible();
  });

  test("does not expose a fake completion control on the public route", async ({ page }) => {
    await page.goto("/journey/simulator/00000000-0000-0000-0000-000000000000");
    await expect(page.getByRole("button", { name: /exit metro|journey complete/i })).toHaveCount(0);
  });
});
