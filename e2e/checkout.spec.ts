import { test, expect } from "@playwright/test";

test("add to cart, check out, see order", async ({ page }) => {
  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());
  // navigate to cart
  await page.getByRole("link", { name: /Cart/ }).click();
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(page.getByText("Merino Tee")).toBeVisible();
  // check out
  await page.getByRole("link", { name: "Check out" }).click();
  await expect(page).toHaveURL(/\/checkout/);
  await page.getByRole("button", { name: /Place stub order/ }).click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
});
