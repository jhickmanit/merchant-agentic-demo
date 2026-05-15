// Mints a Hydra access token via the client_credentials grant.
// Usage: pnpm demo:mint-agent-token   (uses DEMO_AGENT_CLIENT_*)
//   or:  pnpm demo:mint-agent-token <client_id> <client_secret>

export {};

const clientId = process.argv[2] ?? process.env.DEMO_AGENT_CLIENT_ID;
const clientSecret = process.argv[3] ?? process.env.DEMO_AGENT_CLIENT_SECRET;
const baseUrl = process.env.ORY_SDK_URL;

if (!clientId || !clientSecret || !baseUrl) {
  console.error("Missing required env vars. Set DEMO_AGENT_CLIENT_ID, DEMO_AGENT_CLIENT_SECRET, ORY_SDK_URL in .env.local.");
  process.exit(1);
}

async function main() {
  const body = new URLSearchParams({ grant_type: "client_credentials" });
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const res = await fetch(`${baseUrl}/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error("Token request failed:", JSON.stringify(data, null, 2));
    process.exit(1);
  }
  console.log(data.access_token);
}

main().catch((err) => { console.error(err); process.exit(1); });
