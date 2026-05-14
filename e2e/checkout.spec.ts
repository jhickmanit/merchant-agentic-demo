import { test, expect } from "./fixtures/test-identity";

test("sign in, add to cart, check out, see order", async ({ page, gotoAuthenticated }) => {
  // Add item to cart while unauthenticated (cart is anonymous at this point)
  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());

  // Inject Ory session via native login so protected routes are accessible.
  // (Ory hosted Account Experience sets cookies on oryapis.com domain; the auth callback
  // cannot receive them cross-domain without Ory Tunnel. The fixture injects the session token
  // directly, which OrySessionProvider validates via xSessionToken when the value starts with "ory_st_".)
  await gotoAuthenticated("/cart");
  await expect(page.getByRole("heading", { name: "Your cart" })).toBeVisible();
  await expect(page.getByText("Merino Tee")).toBeVisible();
  // Check out
  await page.getByRole("link", { name: "Check out" }).click();
  await page.waitForURL(/\/checkout/);
  await page.getByRole("button", { name: /Place stub order/ }).click();
  await page.waitForURL(/\/orders\//);
  await expect(page.getByRole("heading", { name: "Order placed" })).toBeVisible();
});
