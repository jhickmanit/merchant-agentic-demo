import { NextResponse } from "next/server";

export async function POST() {
  const baseUrl = process.env.ORY_SDK_URL!;
  // For Phase 2: clear our local copy of the Kratos session cookie and bounce
  // the user to Ory's self-service logout endpoint. A full server-side logout
  // (requiring a logout_token) is Phase 10 polish.
  const res = NextResponse.redirect(`${baseUrl}/self-service/logout/browser`);
  res.cookies.set("ory_kratos_session", "", { path: "/", expires: new Date(0) });
  return res;
}
