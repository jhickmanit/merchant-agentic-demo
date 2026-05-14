import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { z } from "zod";
import { getDb } from "@/db";
import { addItem, createCart, removeItem, updateQuantity } from "@/lib/cart";
import {
  CART_COOKIE_NAME,
  CART_COOKIE_MAX_AGE,
  parseCartIdFromCookie,
} from "@/lib/cart-cookie";

const AddSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().positive() });
const RemoveSchema = z.object({ productId: z.string().min(1) });
const UpdateSchema = z.object({ productId: z.string().min(1), quantity: z.number().int().nonnegative() });

async function ensureCartId(): Promise<{ id: string; isNew: boolean }> {
  const store = await cookies();
  const raw = store.get(CART_COOKIE_NAME)?.value;
  const existing = parseCartIdFromCookie(raw);
  if (existing) return { id: existing, isNew: false };
  const id = await createCart(getDb());
  return { id, isNew: true };
}

function setCartCookie(res: NextResponse, id: string) {
  res.cookies.set(CART_COOKIE_NAME, id, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: CART_COOKIE_MAX_AGE,
  });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = AddSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const { id, isNew } = await ensureCartId();
  await addItem(getDb(), id, parsed.data.productId, parsed.data.quantity);
  const res = NextResponse.json({ ok: true, cartId: id });
  if (isNew) setCartCookie(res, id);
  return res;
}

export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = RemoveSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return NextResponse.json({ error: "No cart" }, { status: 404 });
  await removeItem(getDb(), cartId, parsed.data.productId);
  return NextResponse.json({ ok: true });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  const store = await cookies();
  const cartId = parseCartIdFromCookie(store.get(CART_COOKIE_NAME)?.value);
  if (!cartId) return NextResponse.json({ error: "No cart" }, { status: 404 });
  await updateQuantity(getDb(), cartId, parsed.data.productId, parsed.data.quantity);
  return NextResponse.json({ ok: true });
}
