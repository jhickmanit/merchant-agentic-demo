"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function CheckoutForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const res = await fetch("/api/checkout", { method: "POST" });
          const data = await res.json();
          if (!res.ok) {
            setError(data.error ?? "Checkout failed");
            return;
          }
          router.push(`/orders/${data.orderId}`);
        });
      }}
      className="space-y-4"
    >
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        Demo checkout — no payment is taken. Auth and real payment arrive in later phases.
      </div>
      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Placing order…" : "Place stub order"}
      </Button>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
