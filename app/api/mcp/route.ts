import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { getPayments } from "@/lib/payments";
import { listProducts, listByCategory, getProductBySlug } from "@/lib/catalog";
import { addItem, getCartWithItems } from "@/lib/cart";
import { eq } from "drizzle-orm";
import { carts } from "@/db/schema";
import { verifyAgentBearer } from "@/lib/auth/agent-gate";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import { cartTotalFromLines } from "@/lib/cart-math";
import type { DelegationClaims } from "@/lib/auth/delegated-token";

// MCP wire protocol is JSON-RPC 2.0 (https://modelcontextprotocol.io/specification).
// Phase 5 needs only `tools/list` and `tools/call`.

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number | null;
  method: string;
  params?: unknown;
}

interface JsonRpcOk {
  jsonrpc: "2.0";
  id: string | number | null;
  result: unknown;
}

interface JsonRpcErr {
  jsonrpc: "2.0";
  id: string | number | null;
  error: { code: number; message: string; data?: unknown };
}

const TOOLS = [
  {
    name: "searchProducts",
    description:
      "List or filter products from the merchant catalog. Returns a JSON array of products with fields: id, slug, name, priceCents, category. Optional 'category' parameter filters by category slug (apparel, footwear, packs, food, accessories). With no parameter, returns all products. Useful for browsing the catalog before adding items to cart.",
    inputSchema: {
      type: "object",
      properties: {
        category: {
          type: "string",
          description:
            "Category slug filter (optional). Valid values: apparel, footwear, packs, food, accessories.",
        },
      },
    },
  },
  {
    name: "getProduct",
    description:
      "Fetch full details for a single product by its slug. Returns the product's full record including description, image URL, and category. Returns isError=true if no product matches the slug.",
    inputSchema: {
      type: "object",
      properties: {
        slug: { type: "string", description: "The product's URL slug (e.g., 'merino-tee')" },
      },
      required: ["slug"],
    },
  },
  {
    name: "addToCart",
    description:
      "Add a product to the agent's cart. The cart persists across MCP calls within the same agent's session. Returns { ok: true, items: <count> } on success. If the productId doesn't exist, the call fails.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string", description: "Product id from searchProducts or getProduct" },
        quantity: { type: "number", description: "Positive integer quantity to add" },
      },
      required: ["productId", "quantity"],
    },
  },
  {
    name: "viewCart",
    description:
      "Inspect the current cart contents and total. Returns { items: [{ name, quantity, priceCents }], totalCents }. Call this before submitCart to determine the exact amount to authorize via KYA token.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "submitCart",
    description:
      "Submit the cart for payment via a KYAPay token. The token's amount MUST equal the cart's totalCents (call viewCart first to determine this). On success returns { status: 200, body: { orderId, chargeId, settledAt } }. Failure modes include: kya_invalid (signature/expiry/audience), amount_mismatch, hid_mismatch (token's user mismatch), aid_mismatch (token's agent mismatch), spend_cap_exceeded, charge_failed (replay or settlement error).",
    inputSchema: {
      type: "object",
      properties: {
        kyaToken: {
          type: "string",
          description:
            "A JWT-encoded KYAPay token signed by Skyfire (or the mock Skyfire issuer). Mint via the mintKyaToken helper with the cart's totalCents as the amount.",
        },
      },
      required: ["kyaToken"],
    },
  },
];

async function dispatchTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: { agentId: string; ownerUserId: string; cartId: string; delegationClaims?: DelegationClaims },
) {
  const db = getDb();
  switch (name) {
    case "searchProducts": {
      const { category } = z.object({ category: z.string().optional() }).parse(args ?? {});
      const products = category ? await listByCategory(db, category) : await listProducts(db);
      const summary = products.map((p) => ({
        id: p.id,
        slug: p.slug,
        name: p.name,
        priceCents: p.priceCents,
        category: p.categorySlug,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary) }] };
    }
    case "getProduct": {
      const { slug } = z.object({ slug: z.string() }).parse(args ?? {});
      const p = await getProductBySlug(db, slug);
      return {
        content: [
          { type: "text", text: p ? JSON.stringify(p) : `Not found: ${slug}` },
        ],
        isError: !p,
      };
    }
    case "addToCart": {
      const { productId, quantity } = z
        .object({ productId: z.string(), quantity: z.number().int().positive() })
        .parse(args ?? {});
      await addItem(db, ctx.cartId, productId, quantity);
      const cart = await getCartWithItems(db, ctx.cartId);
      return {
        content: [
          { type: "text", text: JSON.stringify({ ok: true, items: cart?.items.length ?? 0 }) },
        ],
      };
    }
    case "viewCart": {
      const cart = await getCartWithItems(db, ctx.cartId);
      const items = cart?.items ?? [];
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              items: items.map((i) => ({
                name: i.product.name,
                quantity: i.quantity,
                priceCents: i.product.priceCents,
              })),
              totalCents: cartTotalFromLines(items),
            }),
          },
        ],
      };
    }
    case "submitCart": {
      const { kyaToken } = z.object({ kyaToken: z.string() }).parse(args ?? {});
      const cart = await getCartWithItems(db, ctx.cartId);
      const items = (cart?.items ?? []).map((i) => ({
        productId: i.productId,
        quantity: i.quantity,
        priceCents: i.product.priceCents,
      }));
      const totalCents = cartTotalFromLines(cart?.items ?? []);
      const { kyaPay } = getPayments();
      const { identity, permission } = getAuth();
      const result = await validateAndCharge({
        kyaJwt: kyaToken,
        cart: { items, totalCents },
        ctx: { agentId: ctx.agentId, ownerUserId: ctx.ownerUserId, cartId: ctx.cartId, delegationClaims: ctx.delegationClaims },
        deps: { db, kyaPay, identity, permission },
      });
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        isError: result.status >= 400,
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown): JsonRpcErr {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}

export async function POST(req: NextRequest) {
  // 1. Authenticate
  const hs = await headers();
  const auth = await verifyAgentBearer(getDb(), hs.get("authorization"));
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message, code: auth.code }, { status: auth.status });
  }

  // 2. Parse the JSON-RPC request
  let body: JsonRpcRequest;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(jsonRpcError(null, -32700, "Parse error"), { status: 400 });
  }
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") {
    return NextResponse.json(
      jsonRpcError(body.id ?? null, -32600, "Invalid request"),
      { status: 400 },
    );
  }

  // 3. Resolve a persistent cart for this agent. The cart id is deterministic
  //    so the same agent accumulates items across multiple MCP requests.
  //    After submitCart, createOrderFromCart clears the items, so the next
  //    request starts with an empty cart — that's the correct behavior.
  const cartId = `agent-cart-${auth.agentId}`;
  const existing = await getDb().query.carts.findFirst({ where: eq(carts.id, cartId) });
  if (!existing) {
    await getDb().insert(carts).values({ id: cartId, userId: auth.ownerUserId });
  }
  const ctx = {
    agentId: auth.agentId,
    ownerUserId: auth.ownerUserId,
    cartId,
    delegationClaims: auth.delegationClaims,
  };

  // 4. Dispatch
  try {
    if (body.method === "tools/list") {
      const ok: JsonRpcOk = { jsonrpc: "2.0", id: body.id, result: { tools: TOOLS } };
      return NextResponse.json(ok);
    }
    if (body.method === "tools/call") {
      const params = body.params as { name: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        return NextResponse.json(jsonRpcError(body.id, -32602, "Invalid params: missing name"));
      }
      const toolResult = await dispatchTool(params.name, params.arguments, ctx);
      const ok: JsonRpcOk = { jsonrpc: "2.0", id: body.id, result: toolResult };
      return NextResponse.json(ok);
    }
    return NextResponse.json(jsonRpcError(body.id, -32601, `Method not found: ${body.method}`));
  } catch (err) {
    return NextResponse.json(
      jsonRpcError(body.id, -32603, "Internal error", { message: (err as Error).message }),
      { status: 200 }, // JSON-RPC errors return 200 with error in body
    );
  }
}
