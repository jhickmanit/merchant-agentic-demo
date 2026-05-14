import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { cartTotalFromLines } from "@/lib/cart-math";
import { formatCents } from "@/lib/format";
import { CheckoutForm } from "@/components/checkout-form";

export default async function CheckoutPage() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const cart = cartId ? await getCartWithItems(getDb(), cartId) : null;
  if (!cart || cart.items.length === 0) redirect("/cart");
  const total = cartTotalFromLines(cart.items);
  return (
    <div className="mx-auto max-w-2xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Checkout</h1>
      <section className="rounded-lg border">
        {cart.items.map((line) => (
          <div key={line.productId} className="flex items-center justify-between border-b px-4 py-3 last:border-b-0">
            <span>
              {line.product.name} × {line.quantity}
            </span>
            <span className="font-medium">{formatCents(line.product.priceCents * line.quantity)}</span>
          </div>
        ))}
        <div className="flex items-center justify-between px-4 py-3 font-semibold">
          <span>Total</span>
          <span>{formatCents(total)}</span>
        </div>
      </section>
      <CheckoutForm />
    </div>
  );
}
