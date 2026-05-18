import { NextResponse, type NextRequest } from "next/server";
import { refreshDelegatedToken } from "@/lib/oauth/refresh";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const refreshToken = body?.refresh_token;
  if (typeof refreshToken !== "string") {
    return NextResponse.json({ error: "missing_refresh_token" }, { status: 400 });
  }
  const clientId = process.env.DEMO_AGENT_CLIENT_ID;
  const clientSecret = process.env.DEMO_AGENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json({ error: "demo_client_not_configured" }, { status: 500 });
  }
  try {
    const result = await refreshDelegatedToken({ refreshToken, clientId, clientSecret });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "refresh_failed", message: (err as Error).message },
      { status: 502 },
    );
  }
}
