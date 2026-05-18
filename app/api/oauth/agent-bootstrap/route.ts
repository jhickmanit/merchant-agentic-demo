import { NextResponse, type NextRequest } from "next/server";
import { bootstrapDelegatedToken } from "@/lib/oauth/bootstrap";

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const kyaJwt = body.kya_jwt;
  if (typeof kyaJwt !== "string") {
    return NextResponse.json({ error: "missing_kya_jwt" }, { status: 400 });
  }
  const clientId = process.env.DEMO_AGENT_CLIENT_ID;
  const clientSecret = process.env.DEMO_AGENT_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.json(
      {
        error: "demo_client_not_configured",
        message: "Set DEMO_AGENT_CLIENT_ID and DEMO_AGENT_CLIENT_SECRET in .env.local",
      },
      { status: 500 },
    );
  }
  try {
    const result = await bootstrapDelegatedToken({ kyaJwt, clientId, clientSecret });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: "bootstrap_failed", message: (err as Error).message },
      { status: 502 },
    );
  }
}
