import { describe, it, expect, beforeEach } from "vitest";
import { freshTestDb } from "@/lib/__tests__/helpers";
import { MemoryIdentityProvider } from "@/lib/auth/memory/identity";
import { MemoryPermissionProvider } from "@/lib/auth/memory/permissions";
import {
  bootstrapSkyfireAgent,
  _clearBridgeCacheForTests,
} from "@/lib/agent/skyfire-bridge";
import type { KyaPayClaims } from "@/lib/payments/types";
import type { BootstrapResult } from "@/lib/oauth/bootstrap";

function makeClaims(overrides: Partial<KyaPayClaims> = {}): KyaPayClaims {
  return {
    iss: "https://app.skyfire.xyz",
    aud: "seller-uuid",
    jti: "jti-bridge-1",
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 300,
    agentId: "414496a0-9fbd-4f44-b4b3-d19d0727d559",
    hid: { email: "skyfire-bridge-test@example.com" },
    aid: { name: "Bose Visa Demo Agent" },
    ...overrides,
  };
}

async function setup() {
  const { db } = freshTestDb();
  const identity = new MemoryIdentityProvider();
  const permission = new MemoryPermissionProvider();
  const calls = { bootstrap: 0, introspect: 0 };

  const bootstrap = async (): Promise<BootstrapResult> => {
    calls.bootstrap++;
    return {
      access_token: `ory_at_${calls.bootstrap}_fake`,
      expires_in: 3600,
      scope: "offline_access openid",
      token_type: "Bearer",
    };
  };

  const introspect = async (
    _token: string,
  ): Promise<Record<string, unknown>> => {
    calls.introspect++;
    return {
      active: true,
      sub: "user-from-introspect",
      ext: {
        act: { sub: "agent-from-introspect", kya_jti: "jti-bridge-1" },
        authorization_details: [
          {
            type: "agent_purchase",
            actions: ["purchase"],
            max_amount: 10_000,
          },
        ],
      },
    };
  };

  return {
    db,
    identity,
    permission,
    deps: {
      db,
      identity,
      permission,
      bootstrap,
      introspect,
      bridgeClientId: "test-bridge-id",
      bridgeClientSecret: "test-bridge-secret",
    },
    calls,
  };
}

describe("bootstrapSkyfireAgent", () => {
  beforeEach(() => {
    _clearBridgeCacheForTests();
  });

  it("first call provisions user + agent + bootstraps a delegated token", async () => {
    const { deps, calls, identity } = await setup();
    const result = await bootstrapSkyfireAgent("kya-jwt-1", makeClaims(), deps);

    expect(result.bootstrapped).toBe(true);
    expect(result.accessToken).toBe("ory_at_1_fake");
    expect(result.ownerUserId).toBeTruthy();
    expect(result.agentId).toBe("414496a0-9fbd-4f44-b4b3-d19d0727d559");
    expect(result.delegationClaims.act.sub).toBe("agent-from-introspect");
    expect(calls.bootstrap).toBe(1);
    expect(calls.introspect).toBe(1);

    // User was auto-provisioned in Kratos
    const user = await identity.getByEmail("skyfire-bridge-test@example.com");
    expect(user?.id).toBeTruthy();
  });

  it("repeat call with same jti hits the cache (no second bootstrap)", async () => {
    const { deps, calls } = await setup();
    const first = await bootstrapSkyfireAgent("kya-jwt-1", makeClaims(), deps);
    const second = await bootstrapSkyfireAgent("kya-jwt-1", makeClaims(), deps);

    expect(first.bootstrapped).toBe(true);
    expect(second.bootstrapped).toBe(false);
    expect(second.accessToken).toBe(first.accessToken);
    expect(calls.bootstrap).toBe(1);
    expect(calls.introspect).toBe(1);
  });

  it("different jti re-bootstraps even with the same user/agent", async () => {
    const { deps, calls } = await setup();
    await bootstrapSkyfireAgent("kya-jwt-a", makeClaims({ jti: "jti-A" }), deps);
    await bootstrapSkyfireAgent("kya-jwt-b", makeClaims({ jti: "jti-B" }), deps);

    expect(calls.bootstrap).toBe(2);
    expect(calls.introspect).toBe(2);
  });

  it("bootstrap failure surfaces as a typed error", async () => {
    const { deps } = await setup();
    deps.bootstrap = async () => {
      throw new Error("hydra unreachable");
    };
    await expect(
      bootstrapSkyfireAgent("kya-jwt-1", makeClaims(), deps),
    ).rejects.toThrow(/hydra unreachable/);
  });

  it("rejects when bridge client env vars are missing", async () => {
    const { deps: full } = await setup();
    const deps = {
      db: full.db,
      identity: full.identity,
      permission: full.permission,
      bootstrap: full.bootstrap,
      introspect: full.introspect,
      // bridgeClientId / bridgeClientSecret intentionally omitted
    };
    const prevId = process.env.SKYFIRE_BRIDGE_CLIENT_ID;
    const prevSecret = process.env.SKYFIRE_BRIDGE_CLIENT_SECRET;
    delete process.env.SKYFIRE_BRIDGE_CLIENT_ID;
    delete process.env.SKYFIRE_BRIDGE_CLIENT_SECRET;
    try {
      await expect(
        bootstrapSkyfireAgent("kya-jwt-1", makeClaims(), deps),
      ).rejects.toThrow(/SKYFIRE_BRIDGE_CLIENT_ID/);
    } finally {
      if (prevId !== undefined) process.env.SKYFIRE_BRIDGE_CLIENT_ID = prevId;
      if (prevSecret !== undefined)
        process.env.SKYFIRE_BRIDGE_CLIENT_SECRET = prevSecret;
    }
  });

  it("rejects when the bootstrapped token introspects as non-delegated", async () => {
    const { deps } = await setup();
    deps.introspect = async () => ({
      active: true,
      sub: "user-x",
      ext: {}, // no act claim
    });
    await expect(
      bootstrapSkyfireAgent("kya-jwt-1", makeClaims(), deps),
    ).rejects.toThrow(/non-delegated/);
  });
});
