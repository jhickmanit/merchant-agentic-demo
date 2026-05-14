export const CART_COOKIE_NAME = "cart_id";
export const CART_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

// nanoid alphabet: A-Z a-z 0-9 _ -
// We accept anything that's at least 8 chars of that alphabet.
const NANOID_RE = /^[A-Za-z0-9_-]{8,}$/;

export function parseCartIdFromCookie(raw: string | undefined): string | null {
  if (!raw) return null;
  return NANOID_RE.test(raw) ? raw : null;
}
