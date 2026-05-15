import { nanoid } from "nanoid";
import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";
import type { OAuth2Client } from "@/lib/auth/types";

export class MemoryOAuth2ClientProvider implements OAuth2ClientProvider {
  private clients = new Map<string, OAuth2Client>();

  async create(args: {
    ownerIdentityId: string;
    grantTypes: string[];
    metadata?: Record<string, string | number | boolean>;
  }): Promise<OAuth2Client> {
    const client: OAuth2Client = {
      id: nanoid(16),
      ownerIdentityId: args.ownerIdentityId,
      grantTypes: args.grantTypes,
      metadata: args.metadata ?? {},
    };
    this.clients.set(client.id, client);
    return client;
  }

  async get(id: string): Promise<OAuth2Client | null> {
    return this.clients.get(id) ?? null;
  }

  async revoke(id: string): Promise<void> {
    this.clients.delete(id);
  }
}
