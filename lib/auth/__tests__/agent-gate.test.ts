import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { agents as agentsTable } from "@/db/schema";
import { verifyAgentBearer } from "@/lib/auth/agent-gate";

const fakeIntrospect = async (token: string): Promise<Record<string, unknown>> => {
  if (token === "good-token-hydra-client-1") return { active: true, client_id: "hydra-client-1" };
  if (token === "good-token-hydra-client-revoked") return { active: true, client_id: "hydra-client-revoked" };
  if (token === "good-token-unknown-client") return { active: true, client_id: "hydra-client-unknown" };
  if (token === "good-token-no-client") return { active: true };
  // anything else is an invalid/expired token
  return { active: false };
};

describe("verifyAgentBearer", () => {
  let testDb: ReturnType<typeof freshTestDb>;

  beforeEach(() => {
    testDb = freshTestDb();
    testDb.db.insert(agentsTable).values([
      {
        id: "agent-1",
        displayName: "A1",
        ownerUserId: "owner-1",
        agentType: "shopping",
        hydraClientId: "hydra-client-1",
      },
      {
        id: "agent-revoked",
        displayName: "R",
        ownerUserId: "owner-1",
        agentType: "shopping",
        hydraClientId: "hydra-client-revoked",
        revokedAt: new Date("2026-01-01"),
      },
    ]).run();
  });

  it("returns 401 when no Authorization header", async () => {
    const result = await verifyAgentBearer(testDb.db, null, { introspect: fakeIntrospect });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when token signature invalid", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer not-a-real-token", { introspect: fakeIntrospect });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when token has no client_id claim", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-no-client", { introspect: fakeIntrospect });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when client_id maps to no agent", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-unknown-client", { introspect: fakeIntrospect });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 403 when the agent is revoked", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-hydra-client-revoked", { introspect: fakeIntrospect });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe("agent_revoked");
    }
  });

  it("returns ok with agent details for a live valid agent", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-hydra-client-1", { introspect: fakeIntrospect });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBe("agent-1");
      expect(result.hydraClientId).toBe("hydra-client-1");
      expect(result.ownerUserId).toBe("owner-1");
    }
  });

  it("returns ok with delegationClaims when introspection shows act.sub", async () => {
    const delegatedIntrospect = async (token: string): Promise<Record<string, unknown>> => {
      if (token === "delegated-good") {
        return {
          active: true,
          sub: "owner-1",
          client_id: "hydra-client-1",
          ext: {
            act: { sub: "agent-1", agent_type: "shopping", kya_jti: "jti-1" },
            authorization_details: [
              { type: "agent_purchase", max_amount: 5000, merchant: "merchant-agentic-demo", currency: "USD" },
            ],
          },
        };
      }
      return { active: false };
    };
    const result = await verifyAgentBearer(testDb.db, "Bearer delegated-good", { introspect: delegatedIntrospect });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBe("agent-1");
      expect(result.delegationClaims?.act.sub).toBe("agent-1");
      expect(result.delegationClaims?.authorization_details[0].max_amount).toBe(5000);
    }
  });

  it("returns 403 when delegated token's agent is revoked", async () => {
    const revokedIntrospect = async (): Promise<Record<string, unknown>> => ({
      active: true,
      sub: "owner-1",
      ext: { act: { sub: "agent-revoked" } },
    });
    const result = await verifyAgentBearer(testDb.db, "Bearer x", { introspect: revokedIntrospect });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(403);
  });
});
