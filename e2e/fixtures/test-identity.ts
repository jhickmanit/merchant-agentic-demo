import { test as base } from "@playwright/test";
import { identityAdmin, frontend } from "../../lib/auth/ory/client";

interface Fixture {
  testUser: { email: string; password: string; id: string };
  /** Navigate to a URL with the test user's Ory session pre-injected as a cookie. */
  gotoAuthenticated: (url: string) => Promise<void>;
}

export const test = base.extend<Fixture>({
  testUser: async ({}, use) => {
    const email = `playwright+${Date.now()}@example.com`;
    const password = "TestPassword123!";

    const schemas = await identityAdmin.listIdentitySchemas({});
    const userSchema = schemas.data.find((s) => !s.id?.startsWith("preset://"));
    if (!userSchema?.id) throw new Error("No custom user schema found");

    const result = await identityAdmin.createIdentity({
      createIdentityBody: {
        schema_id: userSchema.id,
        traits: { email },
        credentials: { password: { config: { password } } },
      },
    });
    const id = result.data.id;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use({ email, password, id });
    await identityAdmin.deleteIdentity({ id });
  },

  gotoAuthenticated: async ({ page, testUser }, use) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    await use(async (url: string) => {
      // Use Ory's native login flow (API-based, no browser) to obtain a session token.
      // The session token (ory_st_...) is stored in the ory_kratos_session cookie on localhost.
      // OrySessionProvider.getCurrentSession() detects "ory_st_" prefix and validates via xSessionToken.
      const flow = await frontend.createNativeLoginFlow();
      const loginResult = await frontend.updateLoginFlow({
        flow: flow.data.id,
        updateLoginFlowBody: {
          method: "password",
          identifier: testUser.email,
          password: testUser.password,
        },
      });
      const sessionToken = loginResult.data.session_token;
      if (!sessionToken) throw new Error("No session token returned from native login flow");

      await page.context().addCookies([
        {
          name: "ory_kratos_session",
          value: sessionToken,
          domain: "localhost",
          path: "/",
          httpOnly: true,
          sameSite: "Lax",
        },
      ]);
      await page.goto(url);
    });
  },
});

export { expect } from "@playwright/test";
