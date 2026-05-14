import type { IdentityProvider } from "@/lib/auth/identity";
import type { User } from "@/lib/auth/types";
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

// Option B: fetch the default schema ID lazily via listIdentitySchemas.
// Ory Network rewrites custom schema IDs to a SHA hash, so we cannot hard-code it.
// We prefer the custom project schema (non-preset://) over preset schemas.
let cachedSchemaId: string | null = null;
async function defaultSchemaId(): Promise<string> {
  if (cachedSchemaId) return cachedSchemaId;
  const res = await identityAdmin.listIdentitySchemas({});
  const schemas = res.data;
  if (!schemas.length) throw new Error("No identity schema found in Ory project");
  // Prefer the custom (non-preset) schema — it supports name.first / name.last traits.
  const custom = schemas.find((s) => !s.id.startsWith("preset://"));
  cachedSchemaId = (custom ?? schemas[0]).id;
  return cachedSchemaId;
}

export class OryIdentityProvider implements IdentityProvider {
  async createUser(traits: { email: string; name?: string }): Promise<User> {
    const [first, ...rest] = (traits.name ?? "").split(/\s+/).filter(Boolean);
    const last = rest.join(" ") || undefined;
    const schemaId = await defaultSchemaId();
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
}
