/**
 * Mock card-payment authorization. Demo-grade: no actual money moves, no PCI
 * scope, no real card numbers should ever be entered. The validator exists so
 * the demo flow — particularly the Bose-style headless browser filling a real
 * merchant form — exercises the same code paths a real PSP integration would
 * (card-number validation, brand detection, decline scenarios) without
 * actually talking to a PSP.
 *
 * Test card conventions match Stripe so anyone who's seen a Stripe demo
 * recognizes them:
 *   4242 4242 4242 4242  → Visa, authorizes
 *   4000 0000 0000 0002  → Visa, always declines (deterministic for demos)
 *   5555 5555 5555 4444  → Mastercard, authorizes
 *   3782 822463 10005    → Amex, authorizes
 */

export interface CardInput {
  number: string; // may contain spaces / dashes
  expiry: string; // MM/YY or MM/YYYY
  cvv: string;
  name: string;
  zip: string;
}

export type CardBrand = "visa" | "mastercard" | "amex" | "discover" | "unknown";

export type AuthorizeResult =
  | {
      ok: true;
      brand: CardBrand;
      last4: string;
      /** Synthetic PSP authorization id. Demo-only. */
      authId: string;
    }
  | {
      ok: false;
      /** Field name (for inline form errors) or "card" for whole-card declines. */
      field: keyof CardInput | "card";
      code:
        | "invalid_number"
        | "invalid_expiry"
        | "expired"
        | "invalid_cvv"
        | "missing_name"
        | "invalid_zip"
        | "card_declined";
      message: string;
    };

const DECLINE_NUMBERS = new Set(["4000000000000002"]);

export function detectBrand(digits: string): CardBrand {
  if (/^4\d{12}(\d{3})?(\d)?$/.test(digits)) return "visa";
  if (/^(5[1-5]\d{14}|2(2[2-9]\d|[3-6]\d{2}|7[01]\d|720)\d{12})$/.test(digits))
    return "mastercard";
  if (/^3[47]\d{13}$/.test(digits)) return "amex";
  if (/^(6011|65|64[4-9])\d{12,15}$/.test(digits)) return "discover";
  return "unknown";
}

/** Luhn checksum. Pure function; takes only digits. */
export function passesLuhn(digits: string): boolean {
  if (!/^\d{12,19}$/.test(digits)) return false;
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}

interface ParsedExpiry {
  month: number;
  year: number;
}

export function parseExpiry(raw: string): ParsedExpiry | null {
  const m = raw.trim().match(/^(\d{1,2})\s*\/\s*(\d{2}|\d{4})$/);
  if (!m) return null;
  const month = Number(m[1]);
  let year = Number(m[2]);
  if (year < 100) year += 2000;
  if (month < 1 || month > 12) return null;
  if (year < 2000 || year > 2100) return null;
  return { month, year };
}

function expiryIsPast({ month, year }: ParsedExpiry, now: Date): boolean {
  // Card is valid through end of expiry month.
  const lastDay = new Date(year, month, 0, 23, 59, 59, 999);
  return now.getTime() > lastDay.getTime();
}

/**
 * Authorize a card. Pure function except for the implicit `Date.now()` for
 * expiry comparison — overridable via `now` for deterministic tests.
 */
export function authorizeCard(input: CardInput, now: Date = new Date()): AuthorizeResult {
  const digits = input.number.replace(/[\s-]/g, "");
  const brand = detectBrand(digits);

  if (!passesLuhn(digits)) {
    return {
      ok: false,
      field: "number",
      code: "invalid_number",
      message: "Card number is invalid.",
    };
  }

  const exp = parseExpiry(input.expiry);
  if (!exp) {
    return {
      ok: false,
      field: "expiry",
      code: "invalid_expiry",
      message: "Expiry must be MM/YY or MM/YYYY.",
    };
  }
  if (expiryIsPast(exp, now)) {
    return {
      ok: false,
      field: "expiry",
      code: "expired",
      message: "Card has expired.",
    };
  }

  const cvvLen = brand === "amex" ? 4 : 3;
  if (!new RegExp(`^\\d{${cvvLen}}$`).test(input.cvv)) {
    return {
      ok: false,
      field: "cvv",
      code: "invalid_cvv",
      message: `CVV must be ${cvvLen} digits.`,
    };
  }

  if (input.name.trim().length < 2) {
    return {
      ok: false,
      field: "name",
      code: "missing_name",
      message: "Name on card is required.",
    };
  }

  if (!/^\d{5}(-\d{4})?$/.test(input.zip.trim())) {
    return {
      ok: false,
      field: "zip",
      code: "invalid_zip",
      message: "ZIP must be 5 digits (or ZIP+4).",
    };
  }

  if (DECLINE_NUMBERS.has(digits)) {
    return {
      ok: false,
      field: "card",
      code: "card_declined",
      message: "Card declined by issuer.",
    };
  }

  return {
    ok: true,
    brand,
    last4: digits.slice(-4),
    authId: `mock_auth_${Math.random().toString(36).slice(2, 12)}`,
  };
}
