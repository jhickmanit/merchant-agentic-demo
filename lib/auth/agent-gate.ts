import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { agents } from "@/db/schema";

export type AgentGateResult =
  | { ok: true; agentId: string; hydraClientId: string; ownerUserId: string }
  | { ok: false; status: number; code: string; message: string };

export interface TokenVerifier {
  decode(token: string): Promise<{ client_id?: string; sub?: string }>;
}

let _prodVerifier: TokenVerifier | null = null;

async function getProdVerifier(): Promise<TokenVerifier> {
  if (_prodVerifier) return _prodVerifier;
  const baseUrl = process.env.ORY_SDK_URL;
  if (!baseUrl) throw new Error("ORY_SDK_URL is not set");
  const { jwtVerify, createRemoteJWKSet } = await import("jose");
  const jwks = createRemoteJWKSet(new URL(`${baseUrl}/.well-known/jwks.json`));
  _prodVerifier = {
    async decode(token: string) {
      const { payload } = await jwtVerify(token, jwks);
      return {
        client_id: (payload as { client_id?: string }).client_id,
        sub: payload.sub,
      };
    },
  };
  return _prodVerifier;
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function verifyAgentBearer(
  db: DB,
  authHeader: string | null,
  opts?: { verifier?: TokenVerifier },
): Promise<AgentGateResult> {
  const token = parseBearer(authHeader);
  if (!token) {
    return { ok: false, status: 401, code: "missing_bearer", message: "Missing or malformed Authorization header" };
  }

  const verifier = opts?.verifier ?? (await getProdVerifier());
  let claims: { client_id?: string; sub?: string };
  try {
    claims = await verifier.decode(token);
  } catch (err) {
    return { ok: false, status: 401, code: "invalid_token", message: (err as Error).message };
  }

  const clientId = claims.client_id ?? claims.sub;
  if (!clientId) {
    return { ok: false, status: 401, code: "missing_client_id", message: "Token has no client_id" };
  }

  const row = await db.query.agents.findFirst({ where: eq(agents.hydraClientId, clientId) });
  if (!row) {
    return { ok: false, status: 401, code: "unknown_agent", message: "No agent registered for that client_id" };
  }
  if (row.revokedAt) {
    return { ok: false, status: 403, code: "agent_revoked", message: "Agent has been revoked" };
  }
  return {
    ok: true,
    agentId: row.id,
    hydraClientId: row.hydraClientId,
    ownerUserId: row.ownerUserId,
  };
}
