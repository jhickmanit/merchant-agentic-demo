import { test, expect } from "./fixtures/test-identity";
import { identityAdmin, frontend } from "../lib/auth/ory/client";

/**
 * Approach B: two signed-in users.
 * - testUser (from fixture) places an order → owns it via Keto tuple.
 * - A second throwaway user (userB) is created inline, signs in via the
 *   same native-login technique the fixture uses, and attempts to view
 *   testUser's order URL.
 * - The page should render "Forbidden" because the Keto check returns false
 *   for userB.
 *
 * Also validates the simpler anonymous case: an unauthenticated browser
 * context should be redirected to /login.
 */

test("anonymous user is redirected to /login when accessing another user's order", async ({
  page,
  gotoAuthenticated,
  browser,
}) => {
  // Place an order as testUser
  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());

  await gotoAuthenticated("/cart");
  await page.getByRole("link", { name: "Check out" }).click();
  await page.waitForURL(/\/checkout/);
  await page.getByRole("button", { name: /Place stub order/ }).click();
  await page.waitForURL(/\/orders\//);
  const orderUrl = page.url();

  // Open a fresh anonymous context and try to access the order
  const anonContext = await browser.newContext();
  const anonPage = await anonContext.newPage();
  try {
    await anonPage.goto(orderUrl);
    // Middleware redirects unauthenticated users to /login
    await anonPage.waitForURL(/\/login/);
  } finally {
    await anonContext.close();
  }
});

test("different signed-in user sees Forbidden via Keto gate", async ({
  page,
  gotoAuthenticated,
  browser,
}) => {
  // Step 1: testUser places an order
  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());

  await gotoAuthenticated("/cart");
  await page.getByRole("link", { name: "Check out" }).click();
  await page.waitForURL(/\/checkout/);
  await page.getByRole("button", { name: /Place stub order/ }).click();
  await page.waitForURL(/\/orders\//);
  const orderUrl = page.url();

  // Step 2: create a second test identity via the admin API (same pattern as the fixture)
  const emailB = `playwright-b+${Date.now()}@example.com`;
  const passwordB = "TestPassword123!";

  const schemas = await identityAdmin.listIdentitySchemas({});
  const userSchema = schemas.data.find((s) => !s.id?.startsWith("preset://"));
  if (!userSchema?.id) throw new Error("No custom user schema found");

  const resultB = await identityAdmin.createIdentity({
    createIdentityBody: {
      schema_id: userSchema.id,
      traits: { email: emailB },
      credentials: { password: { config: { password: passwordB } } },
    },
  });
  const userBId = resultB.data.id;

  try {
    // Step 3: sign userB in via native login flow and inject the session token as a cookie
    const flow = await frontend.createNativeLoginFlow();
    const loginResult = await frontend.updateLoginFlow({
      flow: flow.data.id,
      updateLoginFlowBody: {
        method: "password",
        identifier: emailB,
        password: passwordB,
      },
    });
    const sessionToken = loginResult.data.session_token;
    if (!sessionToken) throw new Error("No session token returned for userB");

    // Step 4: open a new browser context for userB
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    try {
      await contextB.addCookies([
        {
          name: "ory_kratos_session",
          value: sessionToken,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await pageB.goto(orderUrl);
      // Keto denies view permission for userB → page renders "Forbidden" heading
      await expect(pageB.getByRole("heading", { name: "Forbidden" })).toBeVisible({
        timeout: 10_000,
      });
    } finally {
      await contextB.close();
    }
  } finally {
    // Always clean up the throwaway identity
    await identityAdmin.deleteIdentity({ id: userBId });
  }
});
