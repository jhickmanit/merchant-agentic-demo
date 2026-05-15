import { Configuration, FrontendApi, IdentityApi, OAuth2Api } from "@ory/client";

const baseUrl = process.env.ORY_SDK_URL;
// Support both ORY_ADMIN_API_KEY (preferred, per .env.example) and ORY_API_KEY
// (the actual key name used in .env.local during development).
const apiKey = process.env.ORY_ADMIN_API_KEY || process.env.ORY_API_KEY;

if (!baseUrl) throw new Error("ORY_SDK_URL is not set");

const frontendConfig = new Configuration({ basePath: baseUrl });
const adminConfig = new Configuration({
  basePath: baseUrl,
  accessToken: apiKey,
});

export const frontend = new FrontendApi(frontendConfig);
export const identityAdmin = new IdentityApi(adminConfig);
export const oauth2Admin = new OAuth2Api(adminConfig);
export { adminConfig };
