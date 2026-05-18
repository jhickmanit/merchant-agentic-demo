import { MockKyaPayProvider } from "@/lib/payments/mock/kyapay";
import { mintTestKeypair } from "./helpers";
import { runKyaPayContract } from "./kyapay-contract";

runKyaPayContract("MockKyaPayProvider", async () => {
  const { publicKey, privateKey, publicJwk } = await mintTestKeypair();
  return {
    provider: new MockKyaPayProvider({
      publicKey, publicJwk,
      issuer: "http://test-issuer",
      audience: "merchant-agentic-demo",
      sellerServiceId: "merchant-agentic-demo",
    }),
    privateKey,
    issuer: "http://test-issuer",
  };
});
