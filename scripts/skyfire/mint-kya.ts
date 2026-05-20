#!/usr/bin/env tsx
/**
 * Mint a real Skyfire KYA token for manual PoC testing.
 *
 * Usage:
 *   SKYFIRE_BUYER_API_KEY=... pnpm skyfire:mint-kya \
 *     [--sellerDomain http://localhost:3000] [--buyerTag <uuid>] [--expiresIn 300]
 *
 * Prints the JWT to stdout (pipe-clean). All status/diagnostics go to stderr.
 */

import { loadSkyfireConfig } from "@/lib/payments/skyfire/config";

interface Args {
  sellerDomain: string;
  buyerTag?: string;
  expiresIn?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { sellerDomain: "http://localhost:3000" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--sellerDomain") args.sellerDomain = String(argv[++i]);
    else if (a === "--buyerTag") args.buyerTag = String(argv[++i]);
    else if (a === "--expiresIn") args.expiresIn = Number(argv[++i]);
  }
  return args;
}

async function main() {
  const apiKey = process.env.SKYFIRE_BUYER_API_KEY;
  if (!apiKey) {
    console.error("error: SKYFIRE_BUYER_API_KEY env var is required");
    process.exit(1);
  }

  const config = loadSkyfireConfig();
  const args = parseArgs(process.argv.slice(2));

  const body: Record<string, unknown> = {
    type: "kya",
    sellerDomainOrUrl: args.sellerDomain,
  };
  if (args.buyerTag) body.buyerTag = args.buyerTag;
  if (args.expiresIn) {
    body.expiresAt = Math.floor(Date.now() / 1000) + args.expiresIn;
  }

  const url = `${config.apiBase}/tokens`;
  console.error(`POST ${url}`);
  console.error(`  sellerDomainOrUrl: ${args.sellerDomain}`);
  if (args.buyerTag) console.error(`  buyerTag: ${args.buyerTag}`);
  if (args.expiresIn) console.error(`  expiresIn: ${args.expiresIn}s`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "skyfire-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  if (!res.ok) {
    console.error(`error: Skyfire returned ${res.status} ${res.statusText}`);
    console.error(text);
    process.exit(2);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`error: Skyfire response was not JSON:\n${text}`);
    process.exit(3);
  }

  const obj = parsed as Record<string, unknown>;
  const token =
    (typeof obj.token === "string" && obj.token) ||
    (typeof obj.jwt === "string" && obj.jwt) ||
    null;
  if (!token) {
    console.error("error: response did not contain a recognizable token field:");
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(4);
  }

  console.error("✓ minted KYA token");
  process.stdout.write(token);
  process.stdout.write("\n");
}

main().catch((err) => {
  console.error("unexpected error:", err);
  process.exit(99);
});
