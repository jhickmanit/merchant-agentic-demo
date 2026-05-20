import { eq } from "drizzle-orm";
import type { DB } from "@/db";
import { agents } from "@/db/schema";
import type { KyaPayClaims } from "@/lib/payments/types";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { PermissionProvider } from "@/lib/auth/permissions";

export interface AutoProvisionDeps {
  db: DB;
  identity: IdentityProvider;
  permission: PermissionProvider;
}

export interface AutoProvisionResult {
  ownerUserId: string;
  agentId: string;
  createdOwner: boolean;
  createdAgent: boolean;
}

/**
 * Ensure a local user identity and a local agents row exist for the principals
 * named in a verified Skyfire KYA token. Idempotent.
 *
 * - Owner is looked up / created via the IdentityProvider keyed by hid.email.
 * - Agent uses claims.agentId verbatim as the local agents.id (Skyfire's `sub`).
 *   No Kratos agent identity, no Hydra client — KYA is the credential.
 */
export async function ensureAgentAndOwner(
  claims: KyaPayClaims,
  deps: AutoProvisionDeps,
): Promise<AutoProvisionResult> {
  const email = claims.hid.email;
  let owner = await deps.identity.getByEmail(email);
  let createdOwner = false;
  if (!owner) {
    owner = await deps.identity.createUser({
      email,
      name: claims.aid.name,
    });
    createdOwner = true;
  }

  const existing = await deps.db.query.agents.findFirst({
    where: eq(agents.id, claims.agentId),
  });
  let createdAgent = false;
  if (!existing) {
    deps.db
      .insert(agents)
      .values({
        id: claims.agentId,
        displayName: claims.aid.name || "Skyfire Agent",
        ownerUserId: owner.id,
        agentType: "shopping",
        hydraClientId: "skyfire-attested",
        spendCapCents: null,
        expiresAt: null,
      })
      .run();
    createdAgent = true;
    try {
      await deps.permission.addTuple({
        namespace: "Agent",
        object: claims.agentId,
        relation: "owner",
        subject: `User:${owner.id}`,
      });
    } catch (err) {
      console.error(
        `[auto-provision] failed to write Agent:${claims.agentId}#owner tuple:`,
        err,
      );
    }
  }

  return {
    ownerUserId: owner.id,
    agentId: claims.agentId,
    createdOwner,
    createdAgent,
  };
}
