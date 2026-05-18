// MCP demo agent (Phase 7): bootstraps a Hydra-issued delegated access token
// from a KYA, uses that for all MCP calls, mints a fresh settlement KYA at submitCart.
//
// Usage: pnpm demo:agent-mcp --agent <agent-id> --user-email <email> [--agent-name <name>]
//
// No longer requires AGENT_TOKEN — the bootstrap step produces the token internally.

export {};

import { mintKyaToken } from "../lib/payments/mint";

const BASE = "http://localhost:3000";

interface JsonRpcResponse {
  jsonrpc: string;
  id: string;
  result?: {
    tools?: { name: string }[];
    content?: { type: string; text: string }[];
    isError?: boolean;
  };
  error?: { code: number; message: string };
}

async function rpc(token: string, method: string, params: Record<string, unknown>): Promise<JsonRpcResponse> {
  const res = await fetch(`${BASE}/api/mcp`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: Math.random().toString(36).slice(2),
      method,
      params,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  return res.json() as Promise<JsonRpcResponse>;
}

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

async function bootstrapDelegatedToken(kyaJwt: string): Promise<string> {
  const res = await fetch(`${BASE}/api/oauth/agent-bootstrap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kya_jwt: kyaJwt }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Bootstrap failed (HTTP ${res.status}): ${text}`);
  }
  const data = await res.json();
  if (!data.access_token) {
    throw new Error(`Bootstrap response missing access_token: ${JSON.stringify(data)}`);
  }
  return data.access_token;
}

async function main() {
  const agentId = arg("agent");
  const agentName = arg("agent-name", "MCP Phase 7 Bot")!;
  const userEmail = arg("user-email");
  if (!agentId || !userEmail) {
    console.error("Usage: pnpm demo:agent-mcp --agent <agent-id> --user-email <email> [--agent-name <name>]");
    process.exit(1);
  }

  console.log("1. Mint bootstrap KYA (generous amount to allow up-to-cap purchases)");
  const bootstrapKya = await mintKyaToken({
    agentId,
    agentName,
    userEmail,
    amountCents: 100000,
    ttlSeconds: 60,
  });

  console.log("2. POST /api/oauth/agent-bootstrap → get delegated access_token");
  const accessToken = await bootstrapDelegatedToken(bootstrapKya);
  console.log(`   → access_token: ${accessToken.slice(0, 24)}...`);

  console.log("3. MCP tools/list");
  const tools = await rpc(accessToken, "tools/list", {});
  const names = tools.result?.tools?.map((t) => t.name) ?? [];
  console.log("   →", names.join(", "));

  console.log("4. searchProducts (food)");
  const products = await rpc(accessToken, "tools/call", {
    name: "searchProducts",
    arguments: { category: "food" },
  });
  const list = JSON.parse(products.result?.content?.[0]?.text ?? "[]") as Array<{
    id: string;
    slug: string;
    name: string;
    priceCents: number;
  }>;
  console.log("   →", list.length, "products");
  if (list.length === 0) {
    console.error("No products found. Did you run pnpm db:seed?");
    process.exit(1);
  }
  const first = list[0];

  console.log("5. addToCart", first.slug);
  await rpc(accessToken, "tools/call", {
    name: "addToCart",
    arguments: { productId: first.id, quantity: 2 },
  });

  console.log("6. viewCart");
  const cart = await rpc(accessToken, "tools/call", { name: "viewCart", arguments: {} });
  const cartParsed = JSON.parse(cart.result?.content?.[0]?.text ?? "{}") as { totalCents: number };
  console.log("   → totalCents:", cartParsed.totalCents);

  console.log("7. Mint settlement KYA (matching cart total)");
  const settlementKya = await mintKyaToken({
    agentId,
    agentName,
    userEmail,
    amountCents: cartParsed.totalCents,
    ttlSeconds: 60,
  });

  console.log("8. submitCart with settlement KYA");
  const submit = await rpc(accessToken, "tools/call", {
    name: "submitCart",
    arguments: { kyaToken: settlementKya },
  });
  const result = JSON.parse(submit.result?.content?.[0]?.text ?? "{}") as {
    status: number;
    body: { orderId?: string; chargeId?: string; error?: string; message?: string };
  };
  console.log("   → status:", result.status);
  if (result.status !== 200) {
    console.error("Expected 200, got:", result.status, result.body);
    process.exit(1);
  }
  console.log("✓ Phase 7 delegated flow complete:");
  console.log("  Order:", result.body.orderId);
  console.log("  Charge:", result.body.chargeId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
