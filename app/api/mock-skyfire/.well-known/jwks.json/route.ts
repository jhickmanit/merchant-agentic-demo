import { NextResponse } from "next/server";
import { getPayments } from "@/lib/payments";

export async function GET() {
  const { kyaPay } = getPayments();
  const jwks = await kyaPay.jwks();
  return NextResponse.json(jwks, {
    headers: { "Cache-Control": "public, max-age=300" },
  });
}
