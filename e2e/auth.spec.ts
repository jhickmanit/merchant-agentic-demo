import { test, expect } from "./fixtures/test-identity";

test("sign in and sign out", async ({ page, testUser, gotoAuthenticated }) => {
  // Part 1: verify "Sign in" button navigates to Ory Account Experience.
  await page.goto("/");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/projects\.oryapis\.com\/login/);
  // Step 1: enter email and click Continue (Ory uses a two-step flow)
  await page.getByTestId("ory/form/node/input/identifier").fill(testUser.email);
  await page.getByTestId("ory/form/node/button/method").click();
  // Step 2: password field appears — verify Ory accepted the identifier
  await expect(page.getByTestId("ory/form/node/input/password")).toBeVisible({ timeout: 10_000 });

  // Part 2: verify authenticated state and sign-out.
  // Inject session via native login (bypasses cross-domain cookie limitation of hosted Ory UI).
  await gotoAuthenticated("/");
  // Header shows the email prefix as a link to /me
  await expect(page.getByRole("link", { name: testUser.email.split("@")[0] })).toBeVisible();
  // Sign out clears the local session cookie and redirects to Ory logout
  await page.getByRole("button", { name: "Sign out" }).click();
  // After sign-out, navigate back to the home page to verify the unauthenticated state
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});
