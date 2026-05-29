// Usage: pnpm demo:mint-kya-token --agent <id> --agent-name <name> --user-email <email> [--amount-cents <int>]
//
// Prints the JWT as the only stdout line. Requires MOCK_SKYFIRE_PRIVATE_KEY_JWK in env.

export {};

import { mintKyaToken } from "../lib/payments/mint";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}

async function main() {
  const agentId = arg("agent"); //agent-<id> from Ory dashboard (OAuth2 clients list) 
  const agentName = arg("agent-name");
  const userEmail = arg("user-email");
  const amountCents = parseInt(arg("amount-cents", "5000")!, 10);
  if (!agentId || !agentName || !userEmail) {
    console.error("Usage: pnpm demo:mint-kya-token --agent <id> --agent-name <name> --user-email <email> [--amount-cents <int>]");
    process.exit(1);
  }
  const token = await mintKyaToken({ agentId, agentName, userEmail, amountCents });
  process.stdout.write(token + "\n");
}

main().catch((err) => { console.error(err); process.exit(1); });
