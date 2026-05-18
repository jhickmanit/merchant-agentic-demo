import { SignJWT, importJWK, type JWK } from "jose";
import { nanoid } from "nanoid";

export interface MintKyaTokenInput {
  agentId: string;
  agentName: string;
  userEmail: string;
  amountCents: number;
  ttlSeconds?: number;
  issuer?: string;
  audience?: string;
  sellerServiceId?: string;
  privateKey?: CryptoKey;
}

export async function mintKyaToken(input: MintKyaTokenInput): Promise<string> {
  const ttl = input.ttlSeconds ?? 300;
  const iss = input.issuer ?? "http://localhost:3000/api/mock-skyfire";
  const aud = input.audience ?? "merchant-agentic-demo";
  const ssi = input.sellerServiceId ?? "merchant-agentic-demo";

  let privateKey = input.privateKey;
  if (!privateKey) {
    const raw = process.env.MOCK_SKYFIRE_PRIVATE_KEY_JWK;
    if (!raw) throw new Error("MOCK_SKYFIRE_PRIVATE_KEY_JWK not set");
    const jwk = JSON.parse(raw) as JWK;
    privateKey = (await importJWK(jwk, "ES256")) as CryptoKey;
  }

  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    iss,
    aud,
    jti: nanoid(16),
    iat: now,
    exp: now + ttl,
    ssi,
    amount: input.amountCents,
    cur: "USD",
    hid: { email: input.userEmail },
    aid: { id: input.agentId, name: input.agentName },
  })
    .setProtectedHeader({ alg: "ES256", kid: "mock-skyfire-1" })
    .sign(privateKey);
}
