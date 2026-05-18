export interface RefreshInput {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface RefreshResult {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: "Bearer";
}

export async function refreshDelegatedToken(input: RefreshInput): Promise<RefreshResult> {
  const sdkUrl = process.env.ORY_SDK_URL;
  if (!sdkUrl) throw new Error("ORY_SDK_URL not configured");
  const auth = Buffer.from(`${input.clientId}:${input.clientSecret}`).toString("base64");
  const res = await fetch(`${sdkUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: input.refreshToken,
    }).toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Refresh failed: ${JSON.stringify(data)}`);
  }
  return data as RefreshResult;
}
