// One-shot generator. Run via `pnpm gen:mock-skyfire-keys`, then paste the
// output JWKs into .env.local. DO NOT commit the private key.

export {};

import { generateKeyPair, exportJWK } from "jose";

async function main() {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);
  publicJwk.kid = "mock-skyfire-1";
  privateJwk.kid = "mock-skyfire-1";
  publicJwk.alg = "ES256";
  privateJwk.alg = "ES256";
  publicJwk.use = "sig";

  console.log("# Paste these into .env.local:");
  console.log(`MOCK_SKYFIRE_PUBLIC_KEY_JWK='${JSON.stringify(publicJwk)}'`);
  console.log(`MOCK_SKYFIRE_PRIVATE_KEY_JWK='${JSON.stringify(privateJwk)}'`);
}

main();
