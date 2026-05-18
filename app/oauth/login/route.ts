import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { Configuration, OAuth2Api } from "@ory/client";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { agents } from "@/db/schema";
import { getPayments } from "@/lib/payments";
import { getAuth } from "@/lib/auth";

const adminConfig = new Configuration({
  basePath: process.env.ORY_SDK_URL!,
  baseOptions: {
    headers: {
      Authorization: `Bearer ${process.env.ORY_ADMIN_API_KEY ?? process.env.ORY_API_KEY ?? ""}`,
    },
  },
});
const oauth2Admin = new OAuth2Api(adminConfig);

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const loginChallenge = url.searchParams.get("login_challenge");
  if (!loginChallenge) {
    return NextResponse.json({ error: "missing_login_challenge" }, { status: 400 });
  }

  // 1. Read the bootstrap cookie carrying the KYA JWT.
  const store = await cookies();
  const kyaJwt = store.get("kya_bootstrap")?.value;
  if (!kyaJwt) {
    return NextResponse.json(
      { error: "missing_kya_bootstrap_cookie", message: "The agent must set the kya_bootstrap cookie before initiating the Hydra flow" },
      { status: 400 },
    );
  }

  // 2. Verify the KYA via the payments provider.
  const { kyaPay } = getPayments();
  const v = await kyaPay.verify(kyaJwt);
  if (!v.ok) {
    return NextResponse.json(
      { error: "kya_invalid", code: v.code, message: v.message },
      { status: 400 },
    );
  }
  const claims = v.claims;

  // 3. Look up the agent — must exist locally and not be revoked.
  const db = getDb();
  const agentRow = await db.query.agents.findFirst({
    where: eq(agents.id, claims.aid.id),
  });
  if (!agentRow) {
    return NextResponse.json({ error: "unknown_agent", agentId: claims.aid.id }, { status: 403 });
  }
  if (agentRow.revokedAt) {
    return NextResponse.json({ error: "agent_revoked" }, { status: 403 });
  }

  // 4. Look up the owner — must exist, and hid.email must match.
  const { identity } = getAuth();
  const owner = await identity.getById(agentRow.ownerUserId);
  if (!owner) {
    return NextResponse.json({ error: "owner_not_found" }, { status: 403 });
  }
  if (claims.hid.email.toLowerCase() !== owner.email.toLowerCase()) {
    return NextResponse.json(
      { error: "hid_mismatch", expected: owner.email, got: claims.hid.email },
      { status: 403 },
    );
  }

  // 5. Accept the Hydra login challenge. Stash the delegation context for the
  //    consent app to read.
  try {
    const accept = await oauth2Admin.acceptOAuth2LoginRequest({
      loginChallenge,
      acceptOAuth2LoginRequest: {
        subject: owner.id,
        remember: false,
        context: {
          agent_id: agentRow.id,
          agent_type: agentRow.agentType,
          kya_jti: claims.jti,
          kya_amount: claims.amount,
          spend_cap_cents: agentRow.spendCapCents,
        },
      },
    });
    return NextResponse.redirect(accept.data.redirect_to, { status: 302 });
  } catch (err) {
    return NextResponse.json(
      { error: "hydra_accept_failed", message: (err as Error).message },
      { status: 502 },
    );
  }
}
