import type { DB } from "@/db";
import { agents } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { IdentityProvider } from "@/lib/auth/identity";
import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";
import type { PermissionProvider } from "@/lib/auth/permissions";

export interface RegisterAgentInput {
  ownerIdentityId: string;
  displayName: string;
  agentType: "shopping" | "research" | "general";
  spendCapCents?: number;
  expiresAt?: Date;
  allowedMerchants?: string[];
}

export interface RegisteredAgent {
  id: string;
  hydraClientId: string;
}

export async function registerAgent(
  db: DB,
  providers: {
    identity: IdentityProvider;
    oauth2: OAuth2ClientProvider;
    permission: PermissionProvider;
  },
  input: RegisterAgentInput,
): Promise<RegisteredAgent> {
  // 1. Create Kratos agent identity
  const agent = await providers.identity.createAgent({
    displayName: input.displayName,
    ownerIdentityId: input.ownerIdentityId,
    agentType: input.agentType,
  });

  // 2. Create Hydra OAuth2 client
  const client = await providers.oauth2.create({
    ownerIdentityId: agent.id,
    grantTypes: ["client_credentials"],
    metadata: { kratos_identity_id: agent.id },
  });

  // 3. Write Keto ownership tuple (best-effort)
  try {
    await providers.permission.addTuple({
      namespace: "Agent",
      object: agent.id,
      relation: "owner",
      subject: `User:${input.ownerIdentityId}`,
    });
  } catch (err) {
    console.error(`Failed to write Agent:${agent.id}#owner tuple:`, err);
  }

  // 4. Insert denormalized row in local DB (better-sqlite3 is synchronous)
  db.insert(agents).values({
    id: agent.id,
    displayName: input.displayName,
    ownerUserId: input.ownerIdentityId,
    agentType: input.agentType,
    hydraClientId: client.id,
    spendCapCents: input.spendCapCents ?? null,
    expiresAt: input.expiresAt ?? null,
    allowedMerchantsJson: input.allowedMerchants ? JSON.stringify(input.allowedMerchants) : null,
  }).run();

  return { id: agent.id, hydraClientId: client.id };
}

export async function revokeAgent(
  db: DB,
  providers: {
    oauth2: OAuth2ClientProvider;
    permission: PermissionProvider;
  },
  agentId: string,
  ownerIdentityId: string,
): Promise<void> {
  const row = await db.query.agents.findFirst({ where: eq(agents.id, agentId) });
  if (!row) throw new Error(`Agent ${agentId} not found`);
  if (row.ownerUserId !== ownerIdentityId) {
    throw new Error(`Agent ${agentId} is not owned by ${ownerIdentityId}`);
  }
  if (row.revokedAt) return;

  // 1. Revoke Hydra OAuth2 client
  try {
    await providers.oauth2.revoke(row.hydraClientId);
  } catch (err) {
    console.error(`Failed to revoke Hydra client ${row.hydraClientId}:`, err);
  }

  // 2. Delete Keto tuple
  try {
    await providers.permission.removeTuple({
      namespace: "Agent",
      object: agentId,
      relation: "owner",
      subject: `User:${ownerIdentityId}`,
    });
  } catch (err) {
    console.error(`Failed to remove Keto tuple for Agent:${agentId}:`, err);
  }

  // 3. Stamp revokedAt locally
  db.update(agents).set({ revokedAt: new Date() }).where(eq(agents.id, agentId)).run();
}

export async function listAgentsForUser(db: DB, ownerIdentityId: string) {
  return db.query.agents.findMany({
    where: eq(agents.ownerUserId, ownerIdentityId),
    orderBy: (a, { desc }) => [desc(a.createdAt)],
  });
}
