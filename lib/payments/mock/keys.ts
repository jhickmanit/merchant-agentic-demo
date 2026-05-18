import { importJWK, type JWK } from "jose";

let _publicKey: CryptoKey | null = null;
let _privateKey: CryptoKey | null = null;
let _publicJwk: JWK | null = null;

function parseJwkEnv(name: string): JWK {
  const raw = process.env[name];
  if (!raw) {
    throw new Error(`${name} is not set. Run pnpm gen:mock-skyfire-keys and paste into .env.local.`);
  }
  try {
    return JSON.parse(raw) as JWK;
  } catch (err) {
    throw new Error(`${name} is not valid JSON: ${(err as Error).message}`);
  }
}

export async function getPublicKey(): Promise<CryptoKey> {
  if (_publicKey) return _publicKey;
  const jwk = parseJwkEnv("MOCK_SKYFIRE_PUBLIC_KEY_JWK");
  _publicJwk = jwk;
  _publicKey = (await importJWK(jwk, "ES256")) as CryptoKey;
  return _publicKey;
}

export async function getPrivateKey(): Promise<CryptoKey> {
  if (_privateKey) return _privateKey;
  const jwk = parseJwkEnv("MOCK_SKYFIRE_PRIVATE_KEY_JWK");
  _privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
  return _privateKey;
}

export async function getPublicJwk(): Promise<JWK> {
  if (_publicJwk) return _publicJwk;
  await getPublicKey();
  return _publicJwk!;
}

export const KEY_KID = "mock-skyfire-1";
export const MOCK_SKYFIRE_ISSUER = "http://localhost:3000/api/mock-skyfire";
export const MOCK_MERCHANT_AUD = "merchant-agentic-demo";
export const MOCK_SELLER_SSI = "merchant-agentic-demo";
