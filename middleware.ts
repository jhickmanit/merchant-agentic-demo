import { NextResponse, type NextRequest } from "next/server";

const PROTECTED = ["/cart", "/checkout", "/orders", "/me"];
const ORY_SESSION_COOKIE = "ory_kratos_session";
const MEMORY_SESSION_COOKIE = "memory_session";

function hasSessionCookie(req: NextRequest): boolean {
  return Boolean(req.cookies.get(ORY_SESSION_COOKIE) || req.cookies.get(MEMORY_SESSION_COOKIE));
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
