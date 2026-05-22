"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

/**
 * Checkout card form. Used by humans clicking through the storefront AND by
 * the Bose-style headless browser agent (which fills these inputs by DOM
 * `id`/`name` — so don't rename them lightly). The KYA, if present, is
 * already in the agent's request headers via the embedded browser; we only
 * collect card details here.
 *
 * Test cards (Stripe convention, baked into the validator):
 *   4242 4242 4242 4242  → Visa, authorizes
 *   4000 0000 0000 0002  → Visa, always declines
 *   5555 5555 5555 4444  → Mastercard, authorizes
 *   3782 822463 10005    → Amex, authorizes
 */

type FieldErrors = Partial<Record<"number" | "expiry" | "cvv" | "name" | "zip" | "card", string>>;

function formatCardNumber(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 19);
  return digits.replace(/(.{4})/g, "$1 ").trim();
}

function formatExpiry(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

export function CheckoutForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [errors, setErrors] = useState<FieldErrors>({});
  const [generalError, setGeneralError] = useState<string | null>(null);

  // Controlled state so we can apply formatting as the user types.
  const [number, setNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvv, setCvv] = useState("");
  const [name, setName] = useState("");
  const [zip, setZip] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        setGeneralError(null);
        startTransition(async () => {
          const res = await fetch("/api/checkout", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ card: { number, expiry, cvv, name, zip } }),
          });
          const data = await res.json();
          if (!res.ok) {
            if (data?.field && data?.message) {
              setErrors({ [data.field as keyof FieldErrors]: data.message });
            } else {
              setGeneralError(data?.error ?? data?.message ?? "Checkout failed");
            }
            return;
          }
          router.push(`/orders/${data.orderId}`);
        });
      }}
      className="space-y-4"
      aria-label="Payment details"
    >
      <div className="rounded-lg border bg-card p-4 text-sm text-muted-foreground">
        <strong className="text-foreground">Mock checkout.</strong> No real
        payment is processed. Try <code className="font-mono">4242 4242 4242 4242</code> to authorize or{" "}
        <code className="font-mono">4000 0000 0000 0002</code> to see a decline.
      </div>

      <div className="space-y-1">
        <label htmlFor="card-number" className="text-sm font-medium">Card number</label>
        <input
          id="card-number"
          name="card_number"
          inputMode="numeric"
          autoComplete="cc-number"
          placeholder="4242 4242 4242 4242"
          value={number}
          onChange={(e) => setNumber(formatCardNumber(e.target.value))}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono"
          required
        />
        {errors.number && <p className="text-xs text-destructive">{errors.number}</p>}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <label htmlFor="card-expiry" className="text-sm font-medium">Expiry</label>
          <input
            id="card-expiry"
            name="card_expiry"
            inputMode="numeric"
            autoComplete="cc-exp"
            placeholder="MM/YY"
            value={expiry}
            onChange={(e) => setExpiry(formatExpiry(e.target.value))}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono"
            required
          />
          {errors.expiry && <p className="text-xs text-destructive">{errors.expiry}</p>}
        </div>
        <div className="space-y-1">
          <label htmlFor="card-cvv" className="text-sm font-medium">CVV</label>
          <input
            id="card-cvv"
            name="card_cvv"
            inputMode="numeric"
            autoComplete="cc-csc"
            placeholder="123"
            maxLength={4}
            value={cvv}
            onChange={(e) => setCvv(e.target.value.replace(/\D/g, "").slice(0, 4))}
            className="w-full rounded-md border bg-background px-3 py-2 font-mono"
            required
          />
          {errors.cvv && <p className="text-xs text-destructive">{errors.cvv}</p>}
        </div>
      </div>

      <div className="space-y-1">
        <label htmlFor="card-name" className="text-sm font-medium">Name on card</label>
        <input
          id="card-name"
          name="card_name"
          autoComplete="cc-name"
          placeholder="Ada Lovelace"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2"
          required
        />
        {errors.name && <p className="text-xs text-destructive">{errors.name}</p>}
      </div>

      <div className="space-y-1">
        <label htmlFor="billing-zip" className="text-sm font-medium">Billing ZIP</label>
        <input
          id="billing-zip"
          name="billing_zip"
          inputMode="numeric"
          autoComplete="postal-code"
          placeholder="94110"
          value={zip}
          onChange={(e) => setZip(e.target.value)}
          className="w-full rounded-md border bg-background px-3 py-2 font-mono"
          required
        />
        {errors.zip && <p className="text-xs text-destructive">{errors.zip}</p>}
      </div>

      <Button type="submit" size="lg" className="w-full" disabled={pending}>
        {pending ? "Authorizing…" : "Pay now"}
      </Button>
      {errors.card && <p className="text-sm text-destructive">{errors.card}</p>}
      {generalError && <p className="text-sm text-destructive">{generalError}</p>}
    </form>
  );
}
