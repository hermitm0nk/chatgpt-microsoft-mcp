import { describe, expect, it, vi } from "vitest";
import { tokenRequest } from "../src/microsoft";
import { errorResponse } from "../src/errors";
import type { Env } from "../src/types";

const env = { MICROSOFT_OAUTH_ENABLED: "true", MICROSOFT_CLIENT_ID: "client", MICROSOFT_CLIENT_SECRET: "secret",
  TOKEN_ENCRYPTION_KEYS: "configured", TOKEN_ENCRYPTION_KEY_ID: "v1" } as Env;
const valid = { access_token: "private-access", refresh_token: "private-refresh", token_type: "Bearer", expires_in: 3600, scope: "Tasks.ReadWrite", id_token: "private-identity" };

describe("Microsoft token response handling", () => {
  it("accepts case-insensitive Bearer types while rejecting other token types", async () => {
    for (const token_type of ["Bearer", "bearer", "BEARER"]) {
      const result = await tokenRequest(env, async () => Response.json({ ...valid, token_type }), {});
      expect(result.cache.accessToken).toBe(valid.access_token);
    }
    await expect(tokenRequest(env, async () => Response.json({ ...valid, token_type: "MAC" }), {}))
      .rejects.toMatchObject({ diagnostic: { stage: "token_schema", invalidFields: ["token_type"] } });
  });
  it("distinguishes exchange failures without exposing provider values or secrets", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const metrics = vi.spyOn(console, "info").mockImplementation(() => {});
    const cases = [
      { fetcher: async () => { throw new Error("private-network-message"); }, expected: { stage: "token_fetch", reason: "network" } },
      { fetcher: async () => new Response("private-non-json", { status: 502 }), expected: { stage: "token_body", status: 502 } },
      { fetcher: async () => Response.json({ error: "invalid_client", error_description: "private-client-description" }, { status: 401 }), expected: { stage: "token_rejected", status: 401, providerError: "invalid_client" } },
      { fetcher: async () => Response.json({ error: "private-error", error_description: "private-description" }, { status: 500 }), expected: { stage: "token_rejected", status: 500, providerError: "other" } },
      { fetcher: async () => Response.json({ ...valid, expires_in: "private-invalid-expiry" }), expected: { stage: "token_schema", status: 200, invalidFields: ["expires_in"] } },
    ];
    try {
      await tokenRequest(env, async () => Response.json(valid), { grant_type: "authorization_code", code: "private-code" });
      for (const { fetcher, expected } of cases) {
        try { await tokenRequest(env, fetcher, {}); throw new Error("Expected exchange failure"); }
        catch (error) {
          expect(error).toMatchObject({ diagnostic: expected });
          const response = errorResponse(error, "reference");
          expect(await response.text()).not.toContain("private-");
        }
      }
      const output = JSON.stringify([...log.mock.calls, ...metrics.mock.calls]);
      expect(output).not.toContain("private-");
      expect(output).not.toContain("client_secret");
      expect(output).toContain("token_schema");
      expect(output).toContain("microsoft_token_exchange");
    } finally { log.mockRestore(); metrics.mockRestore(); }
  });
});
