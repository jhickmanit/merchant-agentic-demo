import { describe, it, expect, vi, beforeEach } from "vitest";
import { refreshDelegatedToken } from "../refresh";

describe("refreshDelegatedToken", () => {
  beforeEach(() => {
    process.env.ORY_SDK_URL = "https://example.test";
    vi.restoreAllMocks();
  });

  it("posts grant_type=refresh_token with Basic auth and returns the parsed body", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          access_token: "at",
          refresh_token: "rt2",
          expires_in: 300,
          scope: "openid offline_access",
          token_type: "Bearer",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await refreshDelegatedToken({
      refreshToken: "rt1",
      clientId: "cid",
      clientSecret: "secret",
    });

    expect(result.access_token).toBe("at");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.test/oauth2/token");
    expect(init?.method).toBe("POST");
    expect((init?.headers as Record<string, string>)?.Authorization).toMatch(/^Basic /);
    expect(init?.body).toContain("grant_type=refresh_token");
    expect(init?.body).toContain("refresh_token=rt1");
  });

  it("throws on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
    );

    await expect(
      refreshDelegatedToken({ refreshToken: "rt", clientId: "c", clientSecret: "s" }),
    ).rejects.toThrow(/invalid_grant/);
  });
});
