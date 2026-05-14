import Link from "next/link";
import { cookies } from "next/headers";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { ThemeToggle } from "./theme-toggle";
import { Button } from "@/components/ui/button";

async function cartItemCount(): Promise<number> {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return 0;
  const cart = await getCartWithItems(getDb(), cartId);
  if (!cart) return 0;
  return cart.items.reduce((n, i) => n + i.quantity, 0);
}

export async function Header() {
  const count = await cartItemCount();
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          TrailPeak
        </Link>
        <nav className="flex items-center gap-3">
          <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground">
            Orders
          </Link>
          <ThemeToggle />
          <Link href="/cart">
            <Button variant="default" size="sm">
              Cart{count > 0 ? ` · ${count}` : ""}
            </Button>
          </Link>
        </nav>
      </div>
    </header>
  );
}
