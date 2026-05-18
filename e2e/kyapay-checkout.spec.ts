import { test, expect } from "@playwright/test";
import { mintKyaToken } from "../lib/payments/mint";

const skip = !process.env.TEST_AGENT_ID || !process.env.TEST_USER_EMAIL;
test.skip(skip, "TEST_AGENT_ID and TEST_USER_EMAIL must be set in .env.local for this spec");

test("HTML+X-KYA-Token: agent submits, order created with KYAPay payment_method", async ({ page }) => {
  const agentId = process.env.TEST_AGENT_ID!;
  const userEmail = process.env.TEST_USER_EMAIL!;

  await page.goto("/p/merino-tee");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());

  const kya = await mintKyaToken({
    agentId,
    agentName: "E2E Bot",
    userEmail,
    amountCents: 6500,
  });

  const cookies = await page.context().cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: { "X-KYA-Token": kya, Cookie: cookieHeader },
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.orderId).toBeTruthy();
  expect(body.chargeId).toMatch(/^mock-charge-/);
});
