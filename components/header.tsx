import Link from "next/link";
import { cookies } from "next/headers";
import { CART_COOKIE_NAME, parseCartIdFromCookie } from "@/lib/cart-cookie";
import { getDb } from "@/db";
import { getCartWithItems } from "@/lib/cart";
import { getAuth } from "@/lib/auth";
import { ThemeToggle } from "./theme-toggle";
import { AuthButton } from "./auth-button";
import { Button } from "@/components/ui/button";

async function cartItemCount(): Promise<number> {
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return 0;
  const cart = await getCartWithItems(getDb(), cartId);
  if (!cart) return 0;
  return cart.items.reduce((n, i) => n + i.quantity, 0);
}

async function currentUser() {
  const { session } = getAuth();
  const store = await cookies();
  const req = { cookies: { get: (n: string) => store.get(n) } };
  const result = await session.getCurrentSession(req);
  return result?.user ?? null;
}

export async function Header() {
  const [count, user] = await Promise.all([cartItemCount(), currentUser()]);
  return (
    <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="text-lg font-bold tracking-tight">
          TrailPeak
        </Link>
        <nav className="flex items-center gap-3">
          {user && (
            <Link href="/me" className="text-sm text-muted-foreground hover:text-foreground">
              {user.email.split("@")[0]}
            </Link>
          )}
          <Link href="/orders" className="text-sm text-muted-foreground hover:text-foreground">
            Orders
          </Link>
          <ThemeToggle />
          <AuthButton user={user} />
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
