import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agents } from "@/db/schema";

/**
 * Hydra OAuth2 token-hook webhook.
 *
 * IMPORTANT: This route is NOT INVOKED on Ory Network hosted Hydra — the
 * `webhooks.hooks.token.url` config is silently ignored. Spend-cap enforcement
 * on the hosted demo lives entirely in `validateAndCharge()`.
 *
 * On self-hosted Hydra this route becomes live and provides defense in depth:
 * it re-checks the agent's current spend cap on every token issuance/refresh
 * and clamps `authorization_details.max_amount` accordingly. Returning 403
 * causes Hydra to refuse to issue the token.
 *
 * Keep the route in place even on hosted so the migration to self-hosted is
 * a no-code change.
 */

interface TokenHookPayload {
  session?: {
    access_token?: {
      act?: { sub?: string; kya_jti?: string };
      authorization_details?: Array<{ type: string; max_amount?: number; merchant?: string }>;
    };
  };
  subject?: string;
  granted_scopes?: string[];
  client_id?: string;
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as TokenHookPayload;
  const act = body.session?.access_token?.act;
  const agentId = act?.sub;

  // Non-delegated token — pass through unchanged.
  if (!agentId) {
    return NextResponse.json({});
  }

  const row = await getDb().query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!row) {
    return NextResponse.json({ error: "unknown_agent" }, { status: 403 });
  }
  if (row.revokedAt) {
    return NextResponse.json({ error: "agent_revoked" }, { status: 403 });
  }
  if (row.spendCapCents !== null && row.spendCapCents <= 0) {
    return NextResponse.json({ error: "spend_cap_exhausted" }, { status: 403 });
  }

  // Clamp authorization_details.max_amount against current cap.
  const details = body.session?.access_token?.authorization_details ?? [];
  if (row.spendCapCents !== null) {
    for (const d of details) {
      if (
        d.type === "agent_purchase" &&
        typeof d.max_amount === "number" &&
        d.max_amount > row.spendCapCents
      ) {
        d.max_amount = row.spendCapCents;
      }
    }
  }

  return NextResponse.json({
    session: {
      access_token: {
        ...body.session?.access_token,
        authorization_details: details,
      },
    },
  });
}
