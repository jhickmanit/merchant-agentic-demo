import { test, expect } from "@playwright/test";
import { mintKyaToken } from "../lib/payments/mint";

const skip = !process.env.TEST_AGENT_ID || !process.env.TEST_USER_EMAIL;
test.skip(skip, "TEST_AGENT_ID + TEST_USER_EMAIL must be set in .env.local");

test("delegated bootstrap returns Hydra access_token", async () => {
  const agentId = process.env.TEST_AGENT_ID!;
  const userEmail = process.env.TEST_USER_EMAIL!;
  const kya = await mintKyaToken({
    agentId,
    agentName: "E2E Phase 7",
    userEmail,
    amountCents: 100000,
    ttlSeconds: 60,
  });
  const res = await fetch("http://localhost:3000/api/oauth/agent-bootstrap", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kya_jwt: kya }),
  });
  expect(res.status).toBe(200);
  const body = await res.json();
  expect(body.access_token).toBeTruthy();
  expect(body.access_token).toMatch(/^ory_at_/);
});
