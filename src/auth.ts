import { constantEqual, hash, random } from "./crypto";
import { AppError } from "./errors";
import { now, Store } from "./store";
import type { Env, Owner } from "./types";

export function managedOwner(request: Request, env: Env): Owner | null {
  if (env.TRUST_SITES_IDENTITY_HEADERS !== "true") return null;
  const id = request.headers.get("oai-authenticated-user-id");
  if (!id || id.length > 256) return null;
  return { id, email: request.headers.get("oai-authenticated-user-email") || undefined, permission: "write" };
}
export function browserOwner(request: Request, env: Env): Owner {
  if (request.headers.has("X-MCP-API-Key")) throw new AppError("browser_auth_required", 401, "Sign in with ChatGPT to manage Settings.");
  const owner = managedOwner(request, env);
  if (!owner) throw new AppError("browser_auth_required", 401, "Sign in with ChatGPT to manage Settings.");
  return owner;
}
export async function resolveOwner(request: Request, env: Env, store: Store): Promise<Owner> {
  const managed = managedOwner(request, env);
  const token = request.headers.get("X-MCP-API-Key");
  if (!token) {
    if (!managed) throw new AppError("authentication_required", 401, "Sign in with ChatGPT or supply a valid X-MCP-API-Key header.");
    return managed;
  }
  const match = /^todo_([A-Za-z0-9_-]{16})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) throw new AppError("invalid_api_token", 401, "Your personal API token is invalid, expired, or revoked.");
  const row = await store.db.prepare("SELECT owner_id, verifier, permission, expires_at, revoked_at, last_used_at FROM api_tokens WHERE id = ?")
    .bind(match[1]).first<{ owner_id: string; verifier: string; permission: "read" | "write"; expires_at: number; revoked_at: number | null; last_used_at: number | null }>();
  if (!row || !constantEqual(row.verifier, await hash(token)) || row.expires_at <= now() || row.revoked_at !== null)
    throw new AppError("invalid_api_token", 401, "Your personal API token is invalid, expired, or revoked.");
  if (managed && managed.id !== row.owner_id) throw new AppError("conflicting_credentials", 403, "The signed-in user and personal token have different owners.");
  if (!row.last_used_at || row.last_used_at < now() - 3_600_000) {
    await store.db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ? AND owner_id = ? AND revoked_at IS NULL")
      .bind(Math.floor(now() / 3_600_000) * 3_600_000, match[1], row.owner_id).run();
  }
  return { id: row.owner_id, permission: row.permission, tokenId: match[1] };
}
export function requireWrite(owner: Owner): void {
  if (owner.permission !== "write") throw new AppError("read_only_token", 403, "This personal API token permits reading only. Create a read/write token in Settings.");
}
export async function createToken(store: Store, owner: string, label: string, permission: "read" | "write", days: number) {
  await store.ensureUser(owner);
  const active = await store.db.prepare("SELECT count(*) AS count FROM api_tokens WHERE owner_id = ? AND revoked_at IS NULL AND expires_at > ?").bind(owner, now()).first<{ count: number }>();
  if (active && active.count >= 20) throw new AppError("token_limit", 409, "Revoke an existing token before creating another (maximum 20 active tokens).");
  const id = random(12);
  const token = `todo_${id}.${random()}`;
  const createdAt = now();
  const expiresAt = createdAt + days * 86_400_000;
  const inserted = await store.db.prepare(`INSERT INTO api_tokens (id, owner_id, verifier, label, permission, created_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ? WHERE (SELECT count(*) FROM api_tokens WHERE owner_id = ? AND revoked_at IS NULL AND expires_at > ?) < 20`)
    .bind(id, owner, await hash(token), label, permission, createdAt, expiresAt, owner, createdAt).run();
  if (inserted.meta.changes !== 1) throw new AppError("token_limit", 409, "Revoke an existing token before creating another (maximum 20 active tokens).");
  return { id, token, label, permission, createdAt, expiresAt };
}
export async function listTokens(store: Store, owner: string) {
  const result = await store.db.prepare("SELECT id, label, permission, created_at AS createdAt, expires_at AS expiresAt, revoked_at AS revokedAt, last_used_at AS lastUsedAt FROM api_tokens WHERE owner_id = ? ORDER BY created_at DESC LIMIT 100").bind(owner).all();
  return result.results;
}
