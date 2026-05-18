import { NextResponse, type NextRequest } from "next/server";
import { Configuration, OAuth2Api } from "@ory/client";
import { buildConsentClaims, type DelegationContext } from "@/lib/oauth/consent-claims";

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
  const consentChallenge = url.searchParams.get("consent_challenge");
  if (!consentChallenge) {
    return NextResponse.json({ error: "missing_consent_challenge" }, { status: 400 });
  }

  let request;
  try {
    request = await oauth2Admin.getOAuth2ConsentRequest({ consentChallenge });
  } catch (err) {
    return NextResponse.json(
      { error: "hydra_get_consent_failed", message: (err as Error).message },
      { status: 502 },
    );
  }

  const ctx = request.data.context as DelegationContext | undefined;
  if (!ctx?.agent_id || !ctx?.kya_jti) {
    return NextResponse.json(
      { error: "missing_delegation_context", got: Object.keys(ctx ?? {}) },
      { status: 400 },
    );
  }

  const sessionClaims = buildConsentClaims(ctx);

  try {
    const accept = await oauth2Admin.acceptOAuth2ConsentRequest({
      consentChallenge,
      acceptOAuth2ConsentRequest: {
        grant_scope: request.data.requested_scope ?? [],
        grant_access_token_audience: request.data.requested_access_token_audience ?? [],
        remember: false,
        session: {
          access_token: sessionClaims,
          id_token: { act: sessionClaims.act },
        },
      },
    });
    return NextResponse.redirect(accept.data.redirect_to, { status: 302 });
  } catch (err) {
    return NextResponse.json(
      { error: "hydra_accept_consent_failed", message: (err as Error).message },
      { status: 502 },
    );
  }
}
