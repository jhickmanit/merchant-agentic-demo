import { generateKeyPair, exportJWK, type JWK } from "jose";

export async function mintTestKeypair(): Promise<{
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  publicJwk: JWK;
}> {
  const { publicKey, privateKey } = await generateKeyPair("ES256", { extractable: true });
  const publicJwk = await exportJWK(publicKey);
  publicJwk.kid = "test-key-1";
  publicJwk.alg = "ES256";
  publicJwk.use = "sig";
  return { publicKey, privateKey, publicJwk };
}
