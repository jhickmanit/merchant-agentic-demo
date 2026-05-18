import { NextResponse, type NextRequest } from "next/server";

export async function GET(req: NextRequest) {
  // This route is the OAuth2 redirect_uri target. The orchestrator captures
  // the code from the redirect Location header — it never actually fetches
  // this URL. But it must be registered with Hydra as a valid redirect_uri.
  const url = new URL(req.url);
  return NextResponse.json({
    code: url.searchParams.get("code"),
    state: url.searchParams.get("state"),
    error: url.searchParams.get("error"),
  });
}
