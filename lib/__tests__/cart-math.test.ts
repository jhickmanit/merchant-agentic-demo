import { describe, it, expect } from "vitest";
import { cartTotal, cartTotalFromLines, type CartLineWithProduct } from "@/lib/cart-math";

describe("cartTotal", () => {
  it("returns 0 for an empty cart", () => {
    expect(cartTotal([])).toBe(0);
  });

  it("sums prices times quantities", () => {
    const items = [
      { priceCents: 1999, quantity: 2 },
      { priceCents: 500, quantity: 3 },
    ];
    expect(cartTotal(items)).toBe(1999 * 2 + 500 * 3);
  });

  it("rejects negative quantities", () => {
    expect(() => cartTotal([{ priceCents: 100, quantity: -1 }])).toThrow();
  });
});

describe("cartTotalFromLines", () => {
  it("returns 0 for empty cart", () => {
    expect(cartTotalFromLines([])).toBe(0);
  });

  it("sums quantity × product.priceCents", () => {
    const lines: CartLineWithProduct[] = [
      { quantity: 2, product: { priceCents: 1999 } as any },
      { quantity: 3, product: { priceCents: 500 } as any },
    ];
    expect(cartTotalFromLines(lines)).toBe(1999 * 2 + 500 * 3);
  });
});
