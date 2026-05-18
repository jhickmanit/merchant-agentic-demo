import { notFound, redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { getOrderById } from "@/lib/orders";
import { formatCents } from "@/lib/format";
import { withRecording, getRecordedChecks } from "@/lib/permissions-debug";
import { DebugPolicyPanel } from "@/components/debug-policy-panel";

async function loadAndCheck(id: string) {
  const store = await cookies();
  const { session, permission } = getAuth();
  const current = await session.getCurrentSession({
    cookies: { get: (n: string) => store.get(n) },
  });
  if (!current) {
    return { kind: "redirect" as const, to: `/login?return_to=/orders/${id}` };
  }

  const order = await getOrderById(getDb(), id);
  if (!order) {
    return { kind: "notFound" as const };
  }

  const allowed = await permission.check({
    namespace: "Order",
    object: id,
    relation: "view",
    subject: `User:${current.user.id}`,
  });
  return { kind: "ok" as const, order, allowed };
}

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const { result, checks } = await withRecording(async () => {
    const r = await loadAndCheck(id);
    return { result: r, checks: getRecordedChecks() };
  });

  if (result.kind === "redirect") redirect(result.to);
  if (result.kind === "notFound") notFound();

  if (!result.allowed) {
    return (
      <div className="mx-auto max-w-2xl px-6 py-10 space-y-4">
        <h1 className="text-3xl font-bold">Forbidden</h1>
        <p className="text-muted-foreground">
          You don&apos;t have access to this order.
        </p>
        <DebugPolicyPanel checks={checks} />
      </div>
    );
  }

  const order = result.order;
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <header>
        <h1 className="text-3xl font-bold">Order placed</h1>
        <p className="mt-1 font-mono text-sm text-muted-foreground">{order.id}</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Payment:{" "}
          <span className="font-medium text-foreground">{order.paymentMethod}</span>
        </p>
      </header>
      <section className="rounded-lg border">
        {order.items.map((line) => (
          <div
            key={line.productId}
            className="flex items-center justify-between border-b px-4 py-3 last:border-b-0"
          >
            <span>
              {line.product.name} × {line.quantity}
            </span>
            <span className="font-medium">
              {formatCents(line.priceCentsAtPurchase * line.quantity)}
            </span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 font-semibold">
          <span>Total</span>
          <span>{formatCents(order.subtotalCents)}</span>
        </div>
      </section>
      {order.paymentMethod === "kyapay" && (
        <section className="rounded-lg border-2 border-emerald-200 bg-emerald-50/40 dark:border-emerald-900 dark:bg-emerald-950/30 p-4 space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">
            Mandate (KYA Pay)
          </h2>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">Payment method</dt>
            <dd className="font-medium">KYAPay (mock Skyfire)</dd>
            <dt className="text-muted-foreground">Skyfire charge</dt>
            <dd className="font-mono text-xs">{order.skyfireChargeId ?? "—"}</dd>
            <dt className="text-muted-foreground">Token jti</dt>
            <dd className="font-mono text-xs">{order.paymentTokenJti ?? "—"}</dd>
          </dl>
        </section>
      )}
      <DebugPolicyPanel checks={checks} />
    </div>
  );
}
