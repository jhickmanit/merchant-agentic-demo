import { NextResponse, type NextRequest } from "next/server";
import { headers } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { listProducts, listByCategory, getProductBySlug } from "@/lib/catalog";
import { addItem, createCart, getCartWithItems } from "@/lib/cart";
import { verifyAgentBearer } from "@/lib/auth/agent-gate";
import { validateAndCharge } from "@/lib/agent/validate-and-charge";
import { cartTotalFromLines } from "@/lib/cart-math";

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
    description: "List or filter products by category. Returns id, slug, name, priceCents.",
    inputSchema: {
      type: "object",
      properties: { category: { type: "string", description: "Category slug filter (optional)" } },
    },
  },
  {
    name: "getProduct",
    description: "Fetch a single product by slug.",
    inputSchema: {
      type: "object",
      properties: { slug: { type: "string" } },
      required: ["slug"],
    },
  },
  {
    name: "addToCart",
    description: "Add a product to the agent's cart.",
    inputSchema: {
      type: "object",
      properties: {
        productId: { type: "string" },
        quantity: { type: "number" },
      },
      required: ["productId", "quantity"],
    },
  },
  {
    name: "viewCart",
    description: "View the current cart contents and total.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "submitCart",
    description: "Submit the cart for payment via KYA token. Returns 402 in Phase 5 (KYA verification arrives in Phase 6).",
    inputSchema: {
      type: "object",
      properties: { kyaToken: { type: "string" } },
      required: ["kyaToken"],
    },
  },
];

async function dispatchTool(
  name: string,
  args: Record<string, unknown> | undefined,
  ctx: { agentId: string; ownerUserId: string; cartId: string },
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
      const result = await validateAndCharge({
        kyaJwt: kyaToken,
        cart: { items, totalCents },
        ctx: { agentId: ctx.agentId, ownerUserId: ctx.ownerUserId },
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

  // 3. Each authenticated request gets a fresh cart for Phase 5.
  // (Phase 7 will give agents persistent carts via session continuity.)
  const cartId = await createCart(getDb());
  const ctx = { agentId: auth.agentId, ownerUserId: auth.ownerUserId, cartId };

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
