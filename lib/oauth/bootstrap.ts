export interface BootstrapInput {
  kyaJwt: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  redirectUri?: string;
}

export interface BootstrapResult {
  access_token: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
  refresh_token?: string;
}

export async function bootstrapDelegatedToken(input: BootstrapInput): Promise<BootstrapResult> {
  const merchantBase = process.env.MERCHANT_BASE_URL ?? "http://localhost:3000";
  const sdkUrl = process.env.ORY_SDK_URL!;
  const scope = input.scope ?? "offline_access openid";
  const redirectUri = input.redirectUri ?? `${merchantBase}/api/oauth/bootstrap-callback`;
  const state = Math.random().toString(36).slice(2);

  // Cookie jar accumulated across redirect hops.
  const jar = new Map<string, string>();
  jar.set("kya_bootstrap", input.kyaJwt);

  function cookieHeader(): string {
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  function captureSetCookies(headers: Headers) {
    // fetch's getSetCookie() returns string[] of full Set-Cookie headers
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const list: string[] = (headers as any).getSetCookie?.() ?? [];
    for (const sc of list) {
      const [pair] = sc.split(";");
      const [k, v] = pair.split("=");
      if (k && v !== undefined) jar.set(k.trim(), v.trim());
    }
  }

  // Step 1: Hit Hydra's authorization endpoint.
  const authUrl =
    `${sdkUrl}/oauth2/auth?response_type=code&client_id=${encodeURIComponent(input.clientId)}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${state}`;

  let resp = await fetch(authUrl, {
    redirect: "manual",
    headers: { Cookie: cookieHeader() },
  });
  captureSetCookies(resp.headers);

  // Walk redirect chain. Hydra → /oauth/login → Hydra (accept_login redirect_to) → /oauth/consent → Hydra (accept_consent) → redirect_uri
  for (let hop = 0; hop < 12; hop++) {
    if (resp.status >= 200 && resp.status < 300) break;
    if (resp.status < 300 || resp.status >= 400) {
      // 4xx/5xx — drain body for error context
      const body = await resp.text();
      throw new Error(`Bootstrap hop ${hop} got status ${resp.status}: ${body.slice(0, 300)}`);
    }
    const loc = resp.headers.get("location");
    if (!loc) throw new Error(`Bootstrap hop ${hop}: 3xx with no Location header`);

    // If the Location is our callback URL, capture the code and exit the loop.
    if (loc.startsWith(redirectUri)) {
      const url = new URL(loc);
      const code = url.searchParams.get("code");
      if (!code) {
        const error = url.searchParams.get("error");
        throw new Error(`Callback URL has no code (error=${error ?? "none"}): ${loc}`);
      }
      // Exchange code for token.
      const auth = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
      const tokRes = await fetch(`${sdkUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${auth}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
        }).toString(),
      });
      const tok = await tokRes.json();
      if (!tokRes.ok) {
        throw new Error(`/oauth2/token failed: ${JSON.stringify(tok)}`);
      }
      return tok as BootstrapResult;
    }

    // Otherwise, follow the redirect.
    const nextUrl = loc.startsWith("http") ? loc : new URL(loc, sdkUrl).toString();
    resp = await fetch(nextUrl, {
      redirect: "manual",
      headers: { Cookie: cookieHeader() },
    });
    captureSetCookies(resp.headers);
  }
  throw new Error("Bootstrap exceeded 12 redirect hops");
}
