import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { agents as agentsTable } from "@/db/schema";
import { verifyAgentBearer, type TokenVerifier } from "@/lib/auth/agent-gate";

const fakeVerifier: TokenVerifier = {
  async decode(token: string) {
    if (token === "good-token-hydra-client-1") return { client_id: "hydra-client-1" };
    if (token === "good-token-hydra-client-revoked") return { client_id: "hydra-client-revoked" };
    if (token === "good-token-unknown-client") return { client_id: "hydra-client-unknown" };
    if (token === "good-token-no-client") return {};
    throw new Error("invalid token");
  },
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
    const result = await verifyAgentBearer(testDb.db, null, { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when token signature invalid", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer not-a-real-token", { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when token has no client_id claim", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-no-client", { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 401 when client_id maps to no agent", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-unknown-client", { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it("returns 403 when the agent is revoked", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-hydra-client-revoked", { verifier: fakeVerifier });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.code).toBe("agent_revoked");
    }
  });

  it("returns ok with agent details for a live valid agent", async () => {
    const result = await verifyAgentBearer(testDb.db, "Bearer good-token-hydra-client-1", { verifier: fakeVerifier });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.agentId).toBe("agent-1");
      expect(result.hydraClientId).toBe("hydra-client-1");
      expect(result.ownerUserId).toBe("owner-1");
    }
  });
});
