import { test, expect } from "@playwright/test";

test("browse category and product detail", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Apparel", { exact: true }).first().click();
  await expect(page).toHaveURL(/\/c\/apparel/);
  await expect(page.getByRole("heading", { name: "Apparel" })).toBeVisible();
  // Click into a known seeded product
  await page.getByText("Merino Tee").first().click();
  await expect(page).toHaveURL(/\/p\/merino-tee/);
  await expect(page.getByRole("heading", { name: "Merino Tee" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add to cart" })).toBeVisible();
});
