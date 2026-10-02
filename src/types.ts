export interface Env {
  DB: D1Database;
  PUBLIC_BASE_URL: string;
  MICROSOFT_CLIENT_ID: string;
  MICROSOFT_CLIENT_SECRET?: string;
  TOKEN_ENCRYPTION_KEYS?: string;
  TOKEN_ENCRYPTION_KEY_ID?: string;
  MICROSOFT_OAUTH_ENABLED?: string;
  TRUST_SITES_IDENTITY_HEADERS?: string;
}

export interface Owner { id: string; email?: string; permission: "read" | "write"; tokenId?: string }
export interface Connection {
  owner_id: string; id: string; subject: string; label: string; scopes: string;
  encrypted_cache: string; status: "connected" | "reconnect_required";
  expires_at: number; cache_version: number; lease_id: string | null; lease_until: number | null;
}
export interface TokenCache { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] }
export interface Candidate { id: string; subject: string; label: string; cache: TokenCache }
export type Fetcher = typeof fetch;
export interface Dependencies { fetch: Fetcher; validateIdentity?: (jwt: string, nonce: string, env: Env) => Promise<{ subject: string; label: string }> }
