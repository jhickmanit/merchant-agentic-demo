import { describe, it, expect } from "vitest";
import { cartTotal } from "@/lib/cart-math";

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
