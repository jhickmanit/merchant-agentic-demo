import type { KyaPayProvider } from "./kyapay";

let cached: { kyaPay: KyaPayProvider } | null = null;

export function getPayments(): { kyaPay: KyaPayProvider } {
  if (cached) return cached;
  const which = process.env.KYAPAY_PROVIDER ?? "mock";

  if (which === "mock") {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MockKyaPayProvider } = require("./mock/kyapay");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getPublicKey, getPublicJwk, MOCK_SKYFIRE_ISSUER, MOCK_MERCHANT_AUD, MOCK_SELLER_SSI } = require("./mock/keys");

    let _inner: KyaPayProvider | null = null;
    let _initPromise: Promise<KyaPayProvider> | null = null;
    async function init(): Promise<KyaPayProvider> {
      if (_inner) return _inner;
      if (_initPromise) return _initPromise;
      _initPromise = (async () => {
        const publicKey = await getPublicKey();
        const publicJwk = await getPublicJwk();
        _inner = new MockKyaPayProvider({
          publicKey,
          publicJwk,
          issuer: MOCK_SKYFIRE_ISSUER,
          audience: MOCK_MERCHANT_AUD,
          sellerServiceId: MOCK_SELLER_SSI,
        });
        return _inner as KyaPayProvider;
      })();
      return _initPromise;
    }
    const proxy: KyaPayProvider = {
      async verify(jwt) { return (await init()).verify(jwt); },
      async charge(jwt, amt) { return (await init()).charge(jwt, amt); },
      async jwks() { return (await init()).jwks(); },
    };
    cached = { kyaPay: proxy };
    return cached;
  }

  if (which === "skyfire") {
    throw new Error("Real Skyfire provider lands in Phase 8");
  }
  throw new Error(`Unknown KYAPAY_PROVIDER: ${which}`);
}

export function resetPaymentsForTests() {
  cached = null;
}
