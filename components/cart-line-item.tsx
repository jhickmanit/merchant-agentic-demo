"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/format";

interface Props {
  productId: string;
  name: string;
  slug: string;
  imageUrl: string;
  priceCents: number;
  quantity: number;
}

export function CartLineItem({ productId, name, slug, imageUrl, priceCents, quantity }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function update(qty: number) {
    startTransition(async () => {
      await fetch("/api/cart/items", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId, quantity: qty }),
      });
      router.refresh();
    });
  }

  function remove() {
    startTransition(async () => {
      await fetch("/api/cart/items", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ productId }),
      });
      router.refresh();
    });
  }

  return (
    <div className="flex gap-4 border-b py-4 last:border-b-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt={name} className="h-20 w-20 rounded object-cover" />
      <div className="flex-1 space-y-1">
        <a href={`/p/${slug}`} className="font-medium hover:underline">{name}</a>
        <div className="text-sm text-muted-foreground">{formatCents(priceCents)} each</div>
        <div className="flex items-center gap-2 pt-1">
          <Button variant="outline" size="sm" disabled={pending || quantity <= 1} onClick={() => update(quantity - 1)}>−</Button>
          <span className="w-8 text-center text-sm">{quantity}</span>
          <Button variant="outline" size="sm" disabled={pending} onClick={() => update(quantity + 1)}>+</Button>
          <Button variant="ghost" size="sm" disabled={pending} onClick={remove}>Remove</Button>
        </div>
      </div>
      <div className="text-right font-semibold">{formatCents(priceCents * quantity)}</div>
    </div>
  );
}
