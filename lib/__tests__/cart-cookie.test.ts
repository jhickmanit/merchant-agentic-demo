import { describe, it, expect } from "vitest";
import { parseCartIdFromCookie, CART_COOKIE_NAME, CART_COOKIE_MAX_AGE } from "@/lib/cart-cookie";

describe("cart cookie", () => {
  it("exports the cookie name 'cart_id'", () => {
    expect(CART_COOKIE_NAME).toBe("cart_id");
  });

  it("exports a 30-day max-age", () => {
    expect(CART_COOKIE_MAX_AGE).toBe(60 * 60 * 24 * 30);
  });

  it("parseCartIdFromCookie returns null for empty input", () => {
    expect(parseCartIdFromCookie(undefined)).toBeNull();
    expect(parseCartIdFromCookie("")).toBeNull();
  });

  it("parseCartIdFromCookie rejects non-UUID-like values", () => {
    expect(parseCartIdFromCookie("not a cart id")).toBeNull();
    expect(parseCartIdFromCookie("short")).toBeNull();
  });

  it("parseCartIdFromCookie accepts nanoid-shaped values", () => {
    expect(parseCartIdFromCookie("abc123XYZ-_456")).toBe("abc123XYZ-_456");
  });
});
