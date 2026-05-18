// MCP demo agent: connects to localhost:3000/api/mcp, browses, adds to cart,
// mints a KYA token for the cart total, submits, expects HTTP 200.
//
// Usage:
//   AGENT_TOKEN=$(pnpm demo:mint-agent-token | tail -1) \
//     pnpm demo:agent-mcp --agent <agent-id> --user-email <email> [--agent-name <name>]

export {};

import { mintKyaToken } from "../lib/payments/mint";

const BASE = "http://localhost:3000/api/mcp";

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
  const res = await fetch(BASE, {
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

async function main() {
  const token = process.env.AGENT_TOKEN;
  const agentId = arg("agent");
  const agentName = arg("agent-name", "MCP Demo Bot")!;
  const userEmail = arg("user-email");
  if (!token || !agentId || !userEmail) {
    console.error("Usage: AGENT_TOKEN=... pnpm demo:agent-mcp --agent <agent-id> --user-email <email> [--agent-name <name>]");
    process.exit(1);
  }

  console.log("1. tools/list");
  const tools = await rpc(token, "tools/list", {});
  const names = tools.result?.tools?.map((t) => t.name) ?? [];
  console.log("   →", names.join(", "));

  console.log("2. searchProducts (food)");
  const products = await rpc(token, "tools/call", {
    name: "searchProducts",
    arguments: { category: "food" },
  });
  const productsText = products.result?.content?.[0]?.text ?? "[]";
  const list = JSON.parse(productsText) as Array<{
    id: string;
    slug: string;
    name: string;
    priceCents: number;
  }>;
  console.log("   →", list.length, "products");
  if (list.length === 0) {
    console.error("No products found in 'food' category. Did you run pnpm db:seed?");
    process.exit(1);
  }
  const first = list[0];

  console.log("3. addToCart", first.slug);
  await rpc(token, "tools/call", {
    name: "addToCart",
    arguments: { productId: first.id, quantity: 2 },
  });

  console.log("4. viewCart");
  const cart = await rpc(token, "tools/call", { name: "viewCart", arguments: {} });
  const cartText = cart.result?.content?.[0]?.text ?? "{}";
  const cartParsed = JSON.parse(cartText) as { totalCents: number };
  console.log("   → totalCents:", cartParsed.totalCents);

  console.log("5. mintKyaToken (matching cart total)");
  const kya = await mintKyaToken({
    agentId,
    agentName,
    userEmail,
    amountCents: cartParsed.totalCents,
  });

  console.log("6. submitCart with real KYA token");
  const submit = await rpc(token, "tools/call", {
    name: "submitCart",
    arguments: { kyaToken: kya },
  });
  const submitText = submit.result?.content?.[0]?.text ?? "{}";
  const result = JSON.parse(submitText) as {
    status: number;
    body: { orderId?: string; chargeId?: string; error?: string; message?: string };
  };
  console.log("   → status:", result.status);
  if (result.status !== 200) {
    console.error("Expected 200, got:", result.status, result.body);
    process.exit(1);
  }
  console.log("✓ Order placed:", result.body.orderId, "/ charge:", result.body.chargeId);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
