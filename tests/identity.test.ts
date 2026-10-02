import { describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createIdentityValidator } from "../src/microsoft";
import { CONSUMER_TENANT } from "../src/config";
import type { Env } from "../src/types";

describe("Microsoft identity validation", () => {
  it("validates the signature, consumer tenant, issuer, audience, expiry and nonce", async () => {
    const { privateKey, publicKey } = await generateKeyPair("RS256");
    const jwk = { ...await exportJWK(publicKey), kid: "microsoft-test-key", alg: "RS256", use: "sig" };
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe(`https://login.microsoftonline.com/${CONSUMER_TENANT}/discovery/v2.0/keys`);
      expect(init?.redirect).toBe("error");
      return Response.json({ keys: [jwk] });
    });
    const validate = createIdentityValidator(fetcher);
    const env = { MICROSOFT_CLIENT_ID: "registered-client" } as Env;
    const issued = Math.floor(Date.now() / 1000);
    const claims = { sub: "microsoft-subject", tid: CONSUMER_TENANT, nonce: "nonce", name: "Microsoft account",
      iss: `https://login.microsoftonline.com/${CONSUMER_TENANT}/v2.0`, aud: "registered-client", iat: issued, exp: issued + 3600 };
    const sign = (overrides: Record<string, unknown> = {}) => new SignJWT({ ...claims, ...overrides }).setProtectedHeader({ alg: "RS256", kid: jwk.kid }).sign(privateKey);
    expect(await validate(await sign(), "nonce", env)).toEqual({ subject: "microsoft-subject", label: "Microsoft account" });
    for (const override of [{ aud: "other-client" }, { iss: "https://evil.example" }, { tid: "other-tenant" }, { nonce: "wrong-nonce" }, { exp: issued - 120 }]) {
      await expect(validate(await sign(override), "nonce", env)).rejects.toMatchObject({ code: "invalid_microsoft_identity" });
    }
    const jwt = await sign();
    const [header, payload, signature] = jwt.split(".");
    const tampered = `${header}.${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
    await expect(validate(tampered, "nonce", env)).rejects.toMatchObject({ code: "invalid_microsoft_identity" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
