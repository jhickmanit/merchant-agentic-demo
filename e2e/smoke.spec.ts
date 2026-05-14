import { test, expect } from "@playwright/test";

test("landing page renders categories and featured products", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /Outdoor gear for trail/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Shop by category" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Featured" })).toBeVisible();
});
