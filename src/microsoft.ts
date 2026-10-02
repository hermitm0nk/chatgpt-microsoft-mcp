import { createRemoteJWKSet, jwtVerify, customFetch } from "jose";
import { z } from "zod";
import { MICROSOFT_AUTHORITY, CONSUMER_TENANT, OAUTH_SCOPES, oauthReady, redirectUri } from "./config";
import { AppError } from "./errors";
import { boundedText } from "./http";
import { now } from "./store";
import type { Env, Fetcher, TokenCache } from "./types";

export function createIdentityValidator(fetcher: Fetcher = fetch) {
  const keys = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${CONSUMER_TENANT}/discovery/v2.0/keys`), {
    timeoutDuration: 10_000,
    [customFetch]: async (url, options) => {
      const response = await fetcher(url, { ...options, redirect: "error" });
      return new Response(await boundedText(response.body, 262_144), { status: response.status, headers: response.headers });
    },
  });
  return async (jwt: string, nonce: string, env: Env): Promise<{ subject: string; label: string }> => {
  try {
    const { payload } = await jwtVerify(jwt, keys, { issuer: `https://login.microsoftonline.com/${CONSUMER_TENANT}/v2.0`,
      audience: env.MICROSOFT_CLIENT_ID, algorithms: ["RS256"], requiredClaims: ["sub", "exp", "iat", "nonce", "tid"], clockTolerance: 30 });
    if (payload.nonce !== nonce || payload.tid !== CONSUMER_TENANT || typeof payload.sub !== "string" || payload.sub.length > 256) throw new Error();
    const name = typeof payload.name === "string" ? payload.name : "Personal Microsoft account";
    return { subject: payload.sub, label: name.slice(0, 200) };
  } catch { throw new AppError("invalid_microsoft_identity", 400, "Microsoft identity could not be verified. Start again from Settings."); }
  };
}
export const validateIdentity = createIdentityValidator();

const responseSchema = z.object({ access_token: z.string().min(1).max(32_768), refresh_token: z.string().min(1).max(32_768).optional(),
  token_type: z.literal("Bearer"), expires_in: z.number().int().positive().max(86_400), scope: z.string().max(4096), id_token: z.string().max(32_768).optional() });
export async function tokenRequest(env: Env, fetcher: Fetcher, fields: Record<string, string>, previous?: TokenCache): Promise<{ cache: TokenCache; idToken?: string }> {
  oauthReady(env);
  let response: Response;
  try {
    response = await fetcher(`${MICROSOFT_AUTHORITY}/token`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ ...fields, client_id: env.MICROSOFT_CLIENT_ID, client_secret: env.MICROSOFT_CLIENT_SECRET! }) });
  } catch { throw new AppError("microsoft_unavailable", 503, "Microsoft authorization is temporarily unavailable. Try again."); }
  let raw: unknown;
  try { raw = JSON.parse(await boundedText(response.body, 131_072)); }
  catch { throw new AppError("microsoft_unavailable", 503, "Microsoft authorization returned an unusable response. Try again."); }
  if (!response.ok) {
    const code = z.object({ error: z.string() }).safeParse(raw);
    if (code.success && ["invalid_grant", "interaction_required", "consent_required"].includes(code.data.error))
      throw new AppError("reconnect_required", 409, "Microsoft requires you to reconnect from Settings.");
    if (code.success && ["invalid_client", "unauthorized_client", "invalid_scope"].includes(code.data.error))
      throw new AppError("configuration_required", 503, "Microsoft app configuration needs operator attention.");
    throw new AppError("microsoft_unavailable", 503, "Microsoft authorization is temporarily unavailable. Try again.");
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success) throw new AppError("microsoft_unavailable", 503, "Microsoft authorization returned an unusable response. Try again.");
  const data = parsed.data;
  const scopes = data.scope.split(/\s+/).filter(Boolean);
  if (!scopes.some(scope => /^(https:\/\/graph\.microsoft\.com\/)?Tasks\.ReadWrite$/i.test(scope)))
    throw new AppError("missing_microsoft_permission", 409, "Microsoft To Do permission was not granted. Reconnect from Settings.");
  const refreshToken = data.refresh_token || previous?.refreshToken;
  if (!refreshToken) throw new AppError("missing_refresh_token", 409, "Continued Microsoft access was not granted. Reconnect from Settings.");
  return { cache: { accessToken: data.access_token, refreshToken, scopes, expiresAt: now() + data.expires_in * 1000 }, idToken: data.id_token };
}
export const codeFields = (env: Env, code: string, verifier: string): Record<string, string> => ({ grant_type: "authorization_code", code,
  code_verifier: verifier, redirect_uri: redirectUri(env), scope: OAUTH_SCOPES.join(" ") });
