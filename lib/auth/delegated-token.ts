// Verifies a Hydra-issued access token by introspection. Returns the act + sub
// claims if present (delegated flow); returns ok-without-claims for non-delegated.

export interface DelegationClaims {
  sub: string; // delegating user id
  act: { sub: string; agent_type?: string; kya_jti?: string };
  authorization_details: Array<{
    type: string;
    merchant?: string;
    max_amount?: number;
    currency?: string;
    expires_at?: string;
  }>;
  scope?: string;
  exp?: number;
  client_id?: string;
}

export type IntrospectResult =
  | { ok: true; delegated: false; clientId?: string; sub?: string }
  | { ok: true; delegated: true; claims: DelegationClaims }
  | { ok: false; code: string; message: string };

interface AdminOpts {
  /** For tests — inject a function that returns the raw introspection JSON. */
  introspect?: (token: string) => Promise<Record<string, unknown>>;
}

export async function introspectAgentToken(token: string, opts: AdminOpts = {}): Promise<IntrospectResult> {
  let raw: Record<string, unknown>;
  try {
    if (opts.introspect) {
      raw = await opts.introspect(token);
    } else {
      raw = await introspectViaAdminApi(token);
    }
  } catch (err) {
    return { ok: false, code: "introspect_failed", message: (err as Error).message };
  }

  if (!raw.active) {
    return { ok: false, code: "inactive_token", message: "Token is not active (expired/revoked/unknown)" };
  }

  // Hydra puts the consent app's `session.access_token` extras in `ext`.
  const ext = (raw.ext as Record<string, unknown> | undefined) ?? {};
  const act = ext.act as { sub?: string; agent_type?: string; kya_jti?: string } | undefined;
  if (act?.sub) {
    const authorization_details = (ext.authorization_details as DelegationClaims["authorization_details"]) ?? [];
    return {
      ok: true,
      delegated: true,
      claims: {
        sub: (raw.sub as string) ?? "",
        act: { sub: act.sub, agent_type: act.agent_type, kya_jti: act.kya_jti },
        authorization_details,
        scope: raw.scope as string | undefined,
        exp: raw.exp as number | undefined,
        client_id: raw.client_id as string | undefined,
      },
    };
  }

  // Non-delegated (client_credentials path) — legacy Phase 5/6 shape.
  return {
    ok: true,
    delegated: false,
    clientId: raw.client_id as string | undefined,
    sub: raw.sub as string | undefined,
  };
}

async function introspectViaAdminApi(token: string): Promise<Record<string, unknown>> {
  const baseUrl = process.env.ORY_SDK_URL!;
  const apiKey = process.env.ORY_ADMIN_API_KEY ?? process.env.ORY_API_KEY ?? "";
  const res = await fetch(`${baseUrl}/admin/oauth2/introspect`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ token }).toString(),
  });
  if (!res.ok) {
    throw new Error(`introspect: HTTP ${res.status}`);
  }
  return res.json() as Promise<Record<string, unknown>>;
}
