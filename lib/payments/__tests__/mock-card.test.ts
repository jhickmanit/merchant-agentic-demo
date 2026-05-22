import { describe, it, expect } from "vitest";
import {
  authorizeCard,
  detectBrand,
  parseExpiry,
  passesLuhn,
  type CardInput,
} from "@/lib/payments/mock-card";

const VALID = (overrides: Partial<CardInput> = {}): CardInput => ({
  number: "4242 4242 4242 4242",
  expiry: "12/29",
  cvv: "123",
  name: "Ada Lovelace",
  zip: "94110",
  ...overrides,
});

// All authorize calls in this file use a fixed `now` so expiry tests are
// deterministic regardless of when the suite runs.
const NOW = new Date("2026-05-22T00:00:00Z");

describe("passesLuhn", () => {
  it("accepts known-valid card numbers", () => {
    expect(passesLuhn("4242424242424242")).toBe(true);
    expect(passesLuhn("5555555555554444")).toBe(true);
    expect(passesLuhn("378282246310005")).toBe(true);
  });

  it("rejects numbers that fail the checksum", () => {
    expect(passesLuhn("4242424242424241")).toBe(false);
    expect(passesLuhn("1234567812345678")).toBe(false);
  });

  it("rejects non-digit / wrong-length input", () => {
    expect(passesLuhn("abcd")).toBe(false);
    expect(passesLuhn("4242")).toBe(false); // too short
    expect(passesLuhn("4".repeat(20))).toBe(false); // too long
  });
});

describe("detectBrand", () => {
  it.each([
    ["4242424242424242", "visa"],
    ["4111111111111111", "visa"],
    ["5555555555554444", "mastercard"],
    ["2223003122003222", "mastercard"], // 2-series Mastercard
    ["378282246310005", "amex"],
    ["6011111111111117", "discover"],
    ["1234567812345678", "unknown"],
  ])("brand(%s) = %s", (digits, brand) => {
    expect(detectBrand(digits)).toBe(brand);
  });
});

describe("parseExpiry", () => {
  it("parses MM/YY and MM/YYYY", () => {
    expect(parseExpiry("12/29")).toEqual({ month: 12, year: 2029 });
    expect(parseExpiry("01/2030")).toEqual({ month: 1, year: 2030 });
    expect(parseExpiry(" 7 / 28 ")).toEqual({ month: 7, year: 2028 });
  });

  it("rejects junk", () => {
    expect(parseExpiry("13/30")).toBeNull(); // month out of range
    expect(parseExpiry("00/30")).toBeNull();
    expect(parseExpiry("12-29")).toBeNull(); // wrong separator
    expect(parseExpiry("not a date")).toBeNull();
  });
});

describe("authorizeCard", () => {
  it("happy path: Visa test card authorizes", () => {
    const r = authorizeCard(VALID(), NOW);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error("unreachable");
    expect(r.brand).toBe("visa");
    expect(r.last4).toBe("4242");
    expect(r.authId).toMatch(/^mock_auth_/);
  });

  it("strips spaces and dashes from card number", () => {
    const r = authorizeCard(VALID({ number: "4242-4242-4242-4242" }), NOW);
    expect(r.ok).toBe(true);
  });

  it("declines the Stripe-style decline card", () => {
    const r = authorizeCard(VALID({ number: "4000000000000002" }), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("card_declined");
    expect(r.field).toBe("card");
  });

  it("rejects bad Luhn", () => {
    const r = authorizeCard(VALID({ number: "4242424242424241" }), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("invalid_number");
    expect(r.field).toBe("number");
  });

  it("rejects expired cards", () => {
    const r = authorizeCard(VALID({ expiry: "01/20" }), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error("unreachable");
    expect(r.code).toBe("expired");
  });

  it("requires 3-digit CVV for Visa, 4-digit for Amex", () => {
    expect(authorizeCard(VALID({ cvv: "12" }), NOW).ok).toBe(false);
    expect(authorizeCard(VALID({ cvv: "1234" }), NOW).ok).toBe(false);
    const amex = authorizeCard(
      VALID({ number: "378282246310005", cvv: "1234" }),
      NOW,
    );
    expect(amex.ok).toBe(true);
    const amexShort = authorizeCard(
      VALID({ number: "378282246310005", cvv: "123" }),
      NOW,
    );
    expect(amexShort.ok).toBe(false);
  });

  it("rejects empty / 1-char names", () => {
    expect(authorizeCard(VALID({ name: "" }), NOW).ok).toBe(false);
    expect(authorizeCard(VALID({ name: " a " }), NOW).ok).toBe(false);
  });

  it("accepts ZIP and ZIP+4, rejects others", () => {
    expect(authorizeCard(VALID({ zip: "94110" }), NOW).ok).toBe(true);
    expect(authorizeCard(VALID({ zip: "94110-1234" }), NOW).ok).toBe(true);
    expect(authorizeCard(VALID({ zip: "9411" }), NOW).ok).toBe(false);
    expect(authorizeCard(VALID({ zip: "ABCDE" }), NOW).ok).toBe(false);
  });
});
