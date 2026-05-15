// Bose-style demo: drive the HTML site with Playwright, then POST /api/checkout
// with an X-KYA-Token header.

import { chromium } from "@playwright/test";

async function main() {
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

  console.log("4. POST /api/checkout with X-KYA-Token header");
  const cookies = await ctx.cookies();
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const res = await fetch("http://localhost:3000/api/checkout", {
    method: "POST",
    headers: {
      "X-KYA-Token": "fake.kya.jwt.for.phase.5",
      Cookie: cookieHeader,
    },
  });
  console.log("   → status:", res.status);
  console.log("   → WWW-Authenticate:", res.headers.get("www-authenticate"));
  const body = await res.json();
  console.log("   → body:", JSON.stringify(body, null, 2));

  if (res.status !== 402) {
    console.error("Expected 402 in Phase 5, got:", res.status);
    await browser.close();
    process.exit(1);
  }
  console.log("✓ Browser demo agent received expected 402");

  await browser.close();
}

main().catch((err) => { console.error(err); process.exit(1); });
