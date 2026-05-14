import { test, expect } from "@playwright/test";

test("landing page renders heading and CTA", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Merchant Agentic Demo" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Get started" })).toBeVisible();
});
