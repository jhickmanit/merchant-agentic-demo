import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/cart", "/checkout", "/orders", "/me"];
const MEMORY_SESSION_COOKIE = "memory_session";

// Ory Network sets the browser session cookie as `ory_session_<slug>` (project-specific);
// self-hosted Kratos uses `ory_kratos_session`. Match either by prefix so this works for
// any Ory project without hardcoding a slug.
function hasOrySessionCookie(req: NextRequest): boolean {
  return req.cookies.getAll().some(
    (c) => c.name === "ory_kratos_session" || c.name.startsWith("ory_session_"),
  );
}

function hasSessionCookie(req: NextRequest): boolean {
  return hasOrySessionCookie(req) || Boolean(req.cookies.get(MEMORY_SESSION_COOKIE));
}

export function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isProtected = PROTECTED.some((p) => path === p || path.startsWith(`${p}/`));
  if (!isProtected) return NextResponse.next();
  if (hasSessionCookie(req)) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("return_to", `${req.nextUrl.origin}${path}`);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/cart", "/cart/:path*", "/checkout", "/checkout/:path*", "/orders", "/orders/:path*", "/me/:path*"],
};
