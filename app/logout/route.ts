import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const baseUrl = process.env.ORY_SDK_URL!;
  // For Phase 2: clear our local copy of the session cookie and bounce
  // the user to Ory's self-service logout endpoint. A full server-side logout
  // (requiring a logout_token) is Phase 10 polish.
  // Cookie names: `ory_session_<slug>` on Ory Network, `ory_kratos_session` self-hosted.
  const res = NextResponse.redirect(`${baseUrl}/self-service/logout/browser`);
  const store = await cookies();
  for (const c of store.getAll()) {
    if (c.name === "ory_kratos_session" || c.name.startsWith("ory_session_")) {
      res.cookies.set(c.name, "", { path: "/", expires: new Date(0) });
    }
  }
  return res;
}
