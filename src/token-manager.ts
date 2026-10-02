import { z } from "zod";
import { decrypt, encrypt } from "./crypto";
import { AppError } from "./errors";
import { tokenRequest } from "./microsoft";
import { OAUTH_SCOPES } from "./config";
import { now, Store } from "./store";
import type { Fetcher, TokenCache } from "./types";

const cacheSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number(), scopes: z.array(z.string()) });
export async function accessToken(store: Store, owner: string, fetcher: Fetcher): Promise<{ token: string; connectionId: string; cacheVersion: number }> {
  const connection = await store.connection(owner);
  if (!connection) throw new AppError("not_connected", 409, "Connect your Microsoft account from Settings first.");
  if (connection.status === "reconnect_required") throw new AppError("reconnect_required", 409, "Reconnect your Microsoft account from Settings.");
  const binding = `connection:${owner}:${connection.id}`;
  const cache = cacheSchema.parse(await decrypt<TokenCache>(store.env, binding, connection.encrypted_cache));
  if (cache.expiresAt > now() + 60_000) return { token: cache.accessToken, connectionId: connection.id, cacheVersion: connection.cache_version };
  const lease = crypto.randomUUID();
  const locked = await store.db.prepare(`UPDATE microsoft_connections SET lease_id = ?, lease_until = ?
    WHERE owner_id = ? AND id = ? AND cache_version = ? AND status = 'connected' AND (lease_id IS NULL OR lease_until <= ?)`)
    .bind(lease, now() + 30_000, owner, connection.id, connection.cache_version, now()).run();
  if (locked.meta.changes !== 1) throw new AppError("refresh_in_progress", 503, "Microsoft connection is refreshing. Try again shortly.", 1);
  try {
    const result = await tokenRequest(store.env, fetcher, { grant_type: "refresh_token", refresh_token: cache.refreshToken, scope: OAUTH_SCOPES.join(" ") }, cache);
    const encrypted = await encrypt(store.env, binding, result.cache);
    const updated = await store.db.prepare(`UPDATE microsoft_connections SET encrypted_cache = ?, expires_at = ?, scopes = ?, cache_version = cache_version + 1,
      lease_id = NULL, lease_until = NULL, updated_at = ? WHERE owner_id = ? AND id = ? AND cache_version = ? AND lease_id = ? AND lease_until > ?`)
      .bind(encrypted, result.cache.expiresAt, JSON.stringify(result.cache.scopes), now(), owner, connection.id, connection.cache_version, lease, now()).run();
    if (updated.meta.changes !== 1) throw new AppError("connection_changed", 409, "Your Microsoft connection changed. Try again from Settings.");
    return { token: result.cache.accessToken, connectionId: connection.id, cacheVersion: connection.cache_version + 1 };
  } catch (error) {
    if (error instanceof AppError && ["reconnect_required", "missing_microsoft_permission", "missing_refresh_token"].includes(error.code)) {
      await store.db.prepare("UPDATE microsoft_connections SET status = 'reconnect_required' WHERE owner_id = ? AND id = ? AND cache_version = ? AND lease_id = ?")
        .bind(owner, connection.id, connection.cache_version, lease).run();
    }
    throw error;
  } finally {
    await store.db.prepare("UPDATE microsoft_connections SET lease_id = NULL, lease_until = NULL WHERE owner_id = ? AND id = ? AND lease_id = ?")
      .bind(owner, connection.id, lease).run();
  }
}
