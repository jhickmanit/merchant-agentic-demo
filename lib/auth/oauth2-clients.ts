import type { OAuth2Client } from "./types";

export interface OAuth2ClientProvider {
  create(args: {
    ownerIdentityId: string;
    grantTypes: string[];
    metadata?: Record<string, string | number | boolean>;
  }): Promise<OAuth2Client>;
  get(id: string): Promise<OAuth2Client | null>;
  revoke(id: string): Promise<void>;
}
