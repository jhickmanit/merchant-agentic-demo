// One-shot probe: dump Hydra's hosted capabilities.
// Usage: node --env-file=.env.local --import=tsx scripts/probe-hydra-flow.ts

export {};

async function main() {
  const baseUrl = process.env.ORY_SDK_URL;
  const projectId = process.env.ORY_PROJECT_ID;
  if (!baseUrl || !projectId) {
    console.error("ORY_SDK_URL and ORY_PROJECT_ID required");
    process.exit(1);
  }

  console.log("=== Hydra well-known/openid-configuration ===");
  const wkRes = await fetch(`${baseUrl}/.well-known/openid-configuration`);
  const wk = await wkRes.json();
  console.log("issuer:", wk.issuer);
  console.log("authorization_endpoint:", wk.authorization_endpoint);
  console.log("token_endpoint:", wk.token_endpoint);
  console.log(
    "device_authorization_endpoint:",
    wk.device_authorization_endpoint ?? "(not advertised)"
  );
  console.log("grant_types_supported:", wk.grant_types_supported);
  console.log("response_types_supported:", wk.response_types_supported);
  console.log("scopes_supported:", wk.scopes_supported);
  console.log();

  console.log("=== Hydra JWKS ===");
  const jwksRes = await fetch(`${baseUrl}/.well-known/jwks.json`);
  const jwks = await jwksRes.json();
  console.log("key count:", jwks.keys?.length ?? 0);
  console.log("first key kty/alg:", jwks.keys?.[0]?.kty, jwks.keys?.[0]?.alg);
  console.log();

  console.log("=== oauth2-config urls section (via ory CLI) ===");
  console.log(
    "Run: ory get oauth2-config --project",
    projectId,
    '--format json | jq .urls'
  );
  console.log();

  // Probe: does the /oauth2/auth endpoint redirect to our configured login URL?
  // Create a throwaway auth_code client, fire a request, then clean up.
  const pat = process.env.ORY_API_KEY ?? process.env.ORY_ADMIN_API_KEY;
  if (!pat) {
    console.log("=== Auth redirect probe SKIPPED — ORY_API_KEY not set ===");
    return;
  }

  console.log("=== Auth redirect probe ===");
  console.log("Creating a temporary authorization_code client...");
  const createRes = await fetch(`${baseUrl}/admin/clients`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${pat}`,
    },
    body: JSON.stringify({
      client_name: "probe-hydra-flow-tmp",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      redirect_uris: ["http://localhost:3000/api/oauth/bootstrap-callback"],
      scope: "offline_access openid",
    }),
  });
  const client = await createRes.json();
  const clientId = client.client_id;
  if (!clientId) {
    console.error("Failed to create probe client:", JSON.stringify(client));
    return;
  }
  console.log("  → Probe client created:", clientId);

  try {
    const authUrl =
      `${baseUrl}/oauth2/auth` +
      `?response_type=code` +
      `&client_id=${encodeURIComponent(clientId)}` +
      `&redirect_uri=${encodeURIComponent("http://localhost:3000/api/oauth/bootstrap-callback")}` +
      `&scope=${encodeURIComponent("offline_access openid")}` +
      `&state=probe123`;

    const authRes = await fetch(authUrl, { redirect: "manual" });
    const location = authRes.headers.get("location") ?? "(no Location header)";
    console.log("HTTP status:", authRes.status);
    console.log("Location:", location);

    if (location.includes("/oauth/login?login_challenge=")) {
      console.log("  ✓ CONFIRMED: redirects to custom login URL");
    } else if (location.includes("projects.oryapis.com/ui/login")) {
      console.log("  ✗ FAIL: still redirecting to Ory-hosted UI — URL config NOT active");
    } else {
      console.log("  ? UNKNOWN redirect shape — inspect location above");
    }
  } finally {
    await fetch(`${baseUrl}/admin/clients/${encodeURIComponent(clientId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${pat}` },
    });
    console.log("  → Probe client deleted:", clientId);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
