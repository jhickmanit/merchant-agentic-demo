"use server";

import { revalidatePath } from "next/cache";
import { getDb } from "@/db";
import { getAuth } from "@/lib/auth";
import { buildSessionRequest } from "@/lib/auth/request";
import { registerAgent, revokeAgent } from "@/lib/agents";

interface RegisterFormData {
  displayName: string;
  agentType: "shopping" | "research" | "general";
  spendCapCents?: number;
  expiresAt?: string;
}

export async function registerAgentAction(input: RegisterFormData) {
  const { session, identity, oauth2, permission } = getAuth();
  const current = await session.getCurrentSession(await buildSessionRequest());
  if (!current) throw new Error("Not signed in");

  const result = await registerAgent(getDb(), { identity, oauth2, permission }, {
    ownerIdentityId: current.user.id,
    displayName: input.displayName,
    agentType: input.agentType,
    spendCapCents: input.spendCapCents,
    expiresAt: input.expiresAt ? new Date(input.expiresAt) : undefined,
  });

  revalidatePath("/me/agents");
  return result;
}

export async function revokeAgentAction(agentId: string) {
  const { session, oauth2, permission } = getAuth();
  const current = await session.getCurrentSession(await buildSessionRequest());
  if (!current) throw new Error("Not signed in");

  await revokeAgent(getDb(), { oauth2, permission }, agentId, current.user.id);
  revalidatePath("/me/agents");
}
