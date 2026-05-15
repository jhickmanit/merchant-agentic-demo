import type { IdentityProvider } from "@/lib/auth/identity";
import type { User, Agent } from "@/lib/auth/types";
import { identityAdmin } from "./client";

function toUser(identity: { id: string; traits: unknown }): User {
  const traits = identity.traits as { email: string; name?: { first?: string; last?: string } };
  const name = [traits.name?.first, traits.name?.last].filter(Boolean).join(" ").trim();
  return {
    id: identity.id,
    email: traits.email,
    name: name || undefined,
  };
}

function toAgent(identity: { id: string; traits: unknown; schema_id?: string }): Agent {
  const traits = identity.traits as {
    display_name: string;
    owner_identity_id: string;
    agent_type: "shopping" | "research" | "general";
    kya_credential_id?: string;
    attestation_url?: string;
  };
  return {
    id: identity.id,
    displayName: traits.display_name,
    ownerIdentityId: traits.owner_identity_id,
    agentType: traits.agent_type,
    kyaCredentialId: traits.kya_credential_id || undefined,
    attestationUrl: traits.attestation_url || undefined,
  };
}

// Dual-schema cache: Ory Network rewrites custom schema IDs to SHA hashes,
// so we cannot hard-code them. We disambiguate by inspecting trait content:
//   - user schema has an "email" trait
//   - agent schema has "owner_identity_id" / "agent_id" traits
let cachedUserSchemaId: string | null = null;
let cachedAgentSchemaId: string | null = null;

async function getSchemaIds(): Promise<{ user: string; agent: string }> {
  if (cachedUserSchemaId && cachedAgentSchemaId) {
    return { user: cachedUserSchemaId, agent: cachedAgentSchemaId };
  }

  // listIdentitySchemas returns IdentitySchemaContainer[] with id + schema inline.
  const list = await identityAdmin.listIdentitySchemas({});
  const customs = list.data.filter((s) => s.id && !s.id.startsWith("preset://"));

  for (const s of customs) {
    if (!s.id) continue;
    // Prefer inline .schema if present; fall back to getIdentitySchema fetch.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let schema: any = (s as any).schema;
    if (!schema) {
      try {
        const result = await identityAdmin.getIdentitySchema({ id: s.id });
        schema = result.data;
      } catch {
        continue;
      }
    }
    const traits = schema?.properties?.traits?.properties;
    if (!traits) continue;
    if ("email" in traits) cachedUserSchemaId = s.id;
    else if ("owner_identity_id" in traits || "agent_id" in traits) cachedAgentSchemaId = s.id;
  }

  if (!cachedUserSchemaId || !cachedAgentSchemaId) {
    throw new Error(
      `Could not identify both schemas. user=${cachedUserSchemaId ? "found" : "missing"}, agent=${cachedAgentSchemaId ? "found" : "missing"}. Custom schemas: ${customs.map((c) => c.id?.slice(0, 16)).join(", ")}`,
    );
  }
  return { user: cachedUserSchemaId, agent: cachedAgentSchemaId };
}

export class OryIdentityProvider implements IdentityProvider {
  async createUser(traits: { email: string; name?: string }): Promise<User> {
    const [first, ...rest] = (traits.name ?? "").split(/\s+/).filter(Boolean);
    const last = rest.join(" ") || undefined;
    const { user: schemaId } = await getSchemaIds();
    const result = await identityAdmin.createIdentity({
      createIdentityBody: {
        schema_id: schemaId,
        traits: {
          email: traits.email,
          ...(first ? { name: { first, last } } : {}),
        },
      },
    });
    return toUser(result.data);
  }

  async getById(id: string): Promise<User | null> {
    try {
      const result = await identityAdmin.getIdentity({ id });
      return toUser(result.data);
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
  }

  async getByEmail(email: string): Promise<User | null> {
    const result = await identityAdmin.listIdentities({
      credentialsIdentifier: email.toLowerCase(),
    });
    const identity = result.data[0];
    return identity ? toUser(identity) : null;
  }

  async createAgent(traits: {
    displayName: string;
    ownerIdentityId: string;
    agentType: "shopping" | "research" | "general";
  }): Promise<Agent> {
    const { agent: schemaId } = await getSchemaIds();
    const result = await identityAdmin.createIdentity({
      createIdentityBody: {
        schema_id: schemaId,
        traits: {
          display_name: traits.displayName,
          owner_identity_id: traits.ownerIdentityId,
          agent_type: traits.agentType,
          agent_id: "",
          kya_credential_id: "",
          attestation_url: "",
        },
      },
    });
    return toAgent(result.data);
  }

  async getAgentById(id: string): Promise<Agent | null> {
    try {
      const result = await identityAdmin.getIdentity({ id });
      return toAgent(result.data);
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
  }

  async listAgentsByOwner(ownerIdentityId: string): Promise<Agent[]> {
    const { agent: schemaId } = await getSchemaIds();
    // Kratos doesn't support trait-filtered listing on hosted Network.
    // Page through identities filtered by schema_id; filter client-side by owner.
    const all = await identityAdmin.listIdentities({ pageSize: 250 });
    return all.data
      .filter((i: { schema_id?: string }) => i.schema_id === schemaId)
      .map(toAgent)
      .filter((a) => a.ownerIdentityId === ownerIdentityId);
  }
}
