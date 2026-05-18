// Bose-style demo: drive the HTML site with Playwright, then POST /api/checkout
// with an X-KYA-Token header for 6500 cents (one Merino Tee).
//
// Usage: pnpm demo:agent-browser --agent <agent-id> --user-email <email>

export {};

import { chromium } from "@playwright/test";
import { mintKyaToken } from "../lib/payments/mint";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

async function main() {
  const agentId = arg("agent");
  const userEmail = arg("user-email");
  const agentName = arg("agent-name", "Browser Demo Bot")!;
  if (!agentId || !userEmail) {
    console.error("Usage: pnpm demo:agent-browser --agent <agent-id> --user-email <email> [--agent-name <name>]");
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  console.log("1. Navigate to landing");
  await page.goto("http://localhost:3000");

  console.log("2. Browse to product /p/merino-tee");
  await page.goto("http://localhost:3000/p/merino-tee");

  console.log("3. Add to cart (human button)");
  await page.getByRole("button", { name: "Add to cart" }).click();
  await page.waitForResponse((r) => r.url().includes("/api/cart/items") && r.ok());

  console.log("4. Mint KYA token (6500 cents = $65.00, the Merino Tee price)");
  const kya = await mintKyaToken({
    agentId,
    agentName,
    userEmail,
    amountCents: 6500,
  });

  console.log("5. POST /api/checkout with X-KYA-Token header");
  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: {
      "X-KYA-Token": kya,
      Cookie: cookieHeader,
    },
  });
  console.log("   → status:", res.status);
  const body = await res.json();
  console.log("   → body:", JSON.stringify(body, null, 2));

  await browser.close();

  if (res.status !== 200) {
    console.error("Expected 200, got:", res.status);
    process.exit(1);
  }
  console.log("✓ Order placed:", body.orderId, "/ charge:", body.chargeId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
