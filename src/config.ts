import { AppError } from "./errors";
import type { Env } from "./types";

export const MICROSOFT_AUTHORITY = "https://login.microsoftonline.com/consumers/oauth2/v2.0";
export const CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";
export const OAUTH_SCOPES = ["openid", "profile", "offline_access", "Tasks.ReadWrite"];
export function baseUrl(env: Env): string {
  try {
    const url = new URL(env.PUBLIC_BASE_URL);
    if (url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error();
    return url.origin;
  } catch { throw new AppError("configuration_required", 503, "The operator must configure the Site origin."); }
}
export const settingsUrl = (env: Env): string => `${baseUrl(env)}/settings`;
export const redirectUri = (env: Env): string => `${baseUrl(env)}/api/microsoft/oauth-return`;
export function oauthReady(env: Env): void {
  if (env.MICROSOFT_OAUTH_ENABLED !== "true" || !env.MICROSOFT_CLIENT_ID || !env.MICROSOFT_CLIENT_SECRET || !env.TOKEN_ENCRYPTION_KEYS || !env.TOKEN_ENCRYPTION_KEY_ID)
    throw new AppError("configuration_required", 503, "Microsoft linking is awaiting operator setup and callback verification.");
}
