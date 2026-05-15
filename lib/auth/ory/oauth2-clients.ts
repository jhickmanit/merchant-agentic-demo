import type { OAuth2ClientProvider } from "@/lib/auth/oauth2-clients";
import type { OAuth2Client as AppOAuth2Client } from "@/lib/auth/types";
import { oauth2Admin } from "./client";

export class OryOAuth2ClientProvider implements OAuth2ClientProvider {
  async create(args: {
    ownerIdentityId: string;
    grantTypes: string[];
    metadata?: Record<string, string | number | boolean>;
  }): Promise<AppOAuth2Client> {
    const merged = { ...args.metadata, kratos_identity_id: args.ownerIdentityId };
    const result = await oauth2Admin.createOAuth2Client({
      oAuth2Client: {
        client_name: `agent-${args.ownerIdentityId}`,
        grant_types: args.grantTypes,
        token_endpoint_auth_method: "client_secret_basic",
        metadata: merged,
      },
    });
    return {
      id: result.data.client_id ?? "",
      ownerIdentityId: args.ownerIdentityId,
      grantTypes: result.data.grant_types ?? [],
      metadata: (result.data.metadata as Record<string, string | number | boolean>) ?? {},
    };
  }

  async get(id: string): Promise<AppOAuth2Client | null> {
    try {
      const result = await oauth2Admin.getOAuth2Client({ id });
      return {
        id: result.data.client_id ?? "",
        ownerIdentityId:
          (result.data.metadata as { kratos_identity_id?: string } | undefined)?.kratos_identity_id ?? "",
        grantTypes: result.data.grant_types ?? [],
        metadata: (result.data.metadata as Record<string, string | number | boolean>) ?? {},
      };
    } catch (err: unknown) {
      if ((err as { response?: { status?: number } })?.response?.status === 404) return null;
      throw err;
    }
  }

  async revoke(id: string): Promise<void> {
    await oauth2Admin.deleteOAuth2Client({ id });
  }
}
