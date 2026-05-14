import Link from "next/link";
import { cookies } from "next/headers";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { cartTotalFromLines } from "@/lib/cart-math";
import { formatCents } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { CartLineItem } from "@/components/cart-line-item";

export default async function CartPage() {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  const cart = cartId ? await getCartWithItems(getDb(), cartId) : null;
  const items = cart?.items ?? [];
  const total = cartTotalFromLines(items);

  return (
    <div className="mx-auto max-w-3xl px-6 py-10 space-y-6">
      <h1 className="text-3xl font-bold">Your cart</h1>
      {items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center text-muted-foreground">
          Your cart is empty.{" "}
          <Link href="/" className="text-foreground underline">Keep browsing</Link>.
        </div>
      ) : (
        <>
          <div className="rounded-lg border">
            {items.map((item) => (
              <CartLineItem
                key={item.productId}
                productId={item.productId}
                slug={item.product.slug}
                name={item.product.name}
                imageUrl={item.product.imageUrl}
                priceCents={item.product.priceCents}
                quantity={item.quantity}
              />
            ))}
          </div>
          <div className="flex items-center justify-between border-t pt-4">
            <div className="text-lg font-semibold">Total</div>
            <div className="text-2xl font-bold">{formatCents(total)}</div>
          </div>
          <Link href="/checkout">
            <Button className="w-full" size="lg">Check out</Button>
          </Link>
        </>
      )}
    </div>
  );
}
