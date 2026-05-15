import { test, expect } from "@playwright/test";

test("HTML checkout with X-KYA-Token returns 402 + WWW-Authenticate", async ({ request }) => {
  const res = await request.post("/api/checkout", {
    headers: { "X-KYA-Token": "fake.kya.token.for.test" },
  });
  expect(res.status()).toBe(402);
  expect(res.headers()["www-authenticate"]).toMatch(/KYAPay/);
  const body = await res.json();
  expect(body.error).toBe("kya_validation_not_implemented");
  expect(body.phase).toBe(5);
  expect(body.implementsIn).toBe("Phase 6");
});

test("MCP endpoint requires Bearer token", async ({ request }) => {
  const res = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    headers: { "Content-Type": "application/json" },
  });
  expect(res.status()).toBe(401);
});

test("MCP endpoint rejects bogus Bearer token", async ({ request }) => {
  const res = await request.post("/api/mcp", {
    data: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer not-a-real-jwt",
    },
  });
  expect(res.status()).toBe(401);
});
