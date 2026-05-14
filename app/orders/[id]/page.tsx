import { notFound } from "next/navigation";
import { getDb } from "@/db";
import { getOrderById } from "@/lib/orders";
import { formatCents } from "@/lib/format";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrderById(getDb(), id);
  if (!order) notFound();
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Order placed</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{order.id}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Payment: <span className="font-medium text-foreground">{order.paymentMethod}</span>
        </p>
      </header>
      <section className="rounded-lg border">
        {order.items.map((line) => (
          <div key={line.productId} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0">
            <span>{line.product.name} × {line.quantity}</span>
            <span className="font-medium">{formatCents(line.priceCentsAtPurchase * line.quantity)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 font-semibold">
          <span>Total</span>
          <span>{formatCents(order.subtotalCents)}</span>
        </div>
      </section>
    </div>
  );
}
