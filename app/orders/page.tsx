import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { listOrdersForCart } from "@/lib/orders";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { formatCents } from "@/lib/format";

export default async function OrdersPage() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const orders = cartId ? await listOrdersForCart(getDb(), cartId) : [];
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Your orders</h1>
      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No orders yet. Anonymous orders for this session show up here.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {orders.map((o) => (
            <li key={o.id} className="px-4 py-3">
              <Link href={`/orders/${o.id}`} className="flex items-center justify-between hover:underline">
                <span className="font-mono text-sm">{o.id}</span>
                <span className="font-semibold">{formatCents(o.subtotalCents)}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
