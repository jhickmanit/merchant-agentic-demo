import Link from "next/link";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { buildSessionRequest } from "@/lib/auth/request";
import { listOrdersForUser } from "@/lib/orders";
import { formatCents } from "@/lib/format";

export default async function OrdersPage() {
  const { session } = getAuth();
  const current = await session.getCurrentSession(await buildSessionRequest());
  if (!current) redirect("/login?return_to=/orders");

  const orders = await listOrdersForUser(getDb(), current.user.id);
  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Your orders</h1>
      {orders.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          No orders yet.
        </div>
      ) : (
        <ul className="divide-y rounded-lg border">
          {orders.map((o) => (
            <li key={o.id} className="px-4 py-3">
              <Link
                href={`/orders/${o.id}`}
                className="flex items-center justify-between hover:underline"
              >
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
