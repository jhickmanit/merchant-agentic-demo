import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { agents } from "@/db/schema";
import { introspectAgentToken, type DelegationClaims } from "./delegated-token";

export type AgentGateResult =
  | {
      ok: true;
      agentId: string;
      hydraClientId: string;
      ownerUserId: string;
      delegationClaims?: DelegationClaims;
    }
  | { ok: false; status: number; code: string; message: string };

export interface AgentGateOpts {
  /** For tests — inject a function that returns the raw introspection JSON. */
  introspect?: (token: string) => Promise<Record<string, unknown>>;
}

function parseBearer(header: string | null): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

export async function verifyAgentBearer(
  db: DB,
  authHeader: string | null,
  opts?: AgentGateOpts,
): Promise<AgentGateResult> {
  const token = parseBearer(authHeader);
  if (!token) {
    return { ok: false, status: 401, code: "missing_bearer", message: "Missing or malformed Authorization header" };
  }

  const introspectResult = await introspectAgentToken(token, { introspect: opts?.introspect });

  if (!introspectResult.ok) {
    return { ok: false, status: 401, code: introspectResult.code, message: introspectResult.message };
  }

  if (introspectResult.delegated) {
    // Phase 7 delegated path — look up agent by act.sub (agent id)
    const agentId = introspectResult.claims.act.sub;
    const row = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
    if (!row) {
      return { ok: false, status: 401, code: "unknown_agent", message: "No agent registered for that agent id" };
    }
    if (row.revokedAt) {
      return { ok: false, status: 403, code: "agent_revoked", message: "Agent has been revoked" };
    }
    return {
      ok: true,
      agentId: row.id,
      hydraClientId: row.hydraClientId,
      ownerUserId: row.ownerUserId,
      delegationClaims: introspectResult.claims,
    };
  }

  // Phase 5/6 client_credentials path — look up agent by hydra_client_id
  const clientId = introspectResult.clientId ?? introspectResult.sub;
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
