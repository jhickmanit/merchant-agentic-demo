import { test, expect } from "./fixtures/test-identity";

test("register and revoke an agent", async ({ page, gotoAuthenticated }) => {
  await gotoAuthenticated("/me/agents");

  await expect(page.getByRole("heading", { name: "My agents" })).toBeVisible();
  await expect(page.getByText(/No agents yet/)).toBeVisible();

  await page.getByRole("link", { name: "Register agent" }).click();
  await page.waitForURL(/\/me\/agents\/new/);

  await page.getByLabel("Display name").fill("Playwright Bot");
  await page.locator("#agentType").selectOption("shopping");
  await page.getByLabel("Spend cap (USD)").fill("75");
  await page.getByRole("button", { name: /Register agent/i }).click();

  await page.waitForURL(/\/me\/agents$/);
  await expect(page.getByText("Playwright Bot")).toBeVisible();
  await expect(page.getByText("Active", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /^Revoke$/ }).click();
  await expect(page.getByText("Revoked", { exact: true })).toBeVisible({ timeout: 10000 });
});
