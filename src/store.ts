import { AppError } from "./errors";
import { encrypt } from "./crypto";
import type { Candidate, Connection, Env } from "./types";

export const now = (): number => Date.now();
export class Store {
  constructor(readonly env: Env) {}
  get db(): D1Database { return this.env.DB; }
  async ensureUser(owner: string): Promise<number> {
    await this.db.prepare("INSERT INTO users (id, created_at) VALUES (?, ?) ON CONFLICT(id) DO NOTHING").bind(owner, now()).run();
    const user = await this.db.prepare("SELECT generation FROM users WHERE id = ?").bind(owner).first<{ generation: number }>();
    if (!user) throw new Error("User unavailable");
    return user.generation;
  }
  connection(owner: string): Promise<Connection | null> {
    return this.db.prepare("SELECT * FROM microsoft_connections WHERE owner_id = ?").bind(owner).first<Connection>();
  }
  async applyConnection(owner: string, generation: number, candidate: Candidate, revokeTokens: boolean): Promise<void> {
    const encrypted = await encrypt(this.env, `connection:${owner}:${candidate.id}`, candidate.cache);
    const mutation = crypto.randomUUID();
    // A unique mutation marker fences every statement in this atomic D1 batch.
    const results = await this.db.batch([
      this.db.prepare("UPDATE users SET generation = generation + 1, mutation_id = ? WHERE id = ? AND generation = ?").bind(mutation, owner, generation),
      this.db.prepare(`INSERT INTO microsoft_connections (owner_id, id, subject, label, scopes, encrypted_cache, status, expires_at, cache_version, updated_at)
        SELECT ?, ?, ?, ?, ?, ?, 'connected', ?, 0, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND mutation_id = ?)
        ON CONFLICT(owner_id) DO UPDATE SET id = excluded.id, subject = excluded.subject, label = excluded.label,
          scopes = excluded.scopes, encrypted_cache = excluded.encrypted_cache, status = 'connected', expires_at = excluded.expires_at,
          cache_version = microsoft_connections.cache_version + 1, lease_id = NULL, lease_until = NULL, updated_at = excluded.updated_at`)
        .bind(owner, candidate.id, candidate.subject, candidate.label, JSON.stringify(candidate.cache.scopes), encrypted, candidate.cache.expiresAt, now(), owner, mutation),
      this.db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL AND ? = 1 AND EXISTS (SELECT 1 FROM users WHERE id = ? AND mutation_id = ?)")
        .bind(now(), owner, revokeTokens ? 1 : 0, owner, mutation),
      this.db.prepare("DELETE FROM pending_connections WHERE owner_id = ? AND EXISTS (SELECT 1 FROM users WHERE id = ? AND mutation_id = ?)").bind(owner, owner, mutation),
    ]);
    if (results[0].meta.changes !== 1) throw new AppError("connection_changed", 409, "Your connection changed during authorization. Start again from Settings.");
  }
  async disconnect(owner: string): Promise<void> {
    await this.ensureUser(owner);
    await this.db.batch([
      this.db.prepare("UPDATE users SET generation = generation + 1, mutation_id = NULL WHERE id = ?").bind(owner),
      this.db.prepare("DELETE FROM microsoft_connections WHERE owner_id = ?").bind(owner),
      this.db.prepare("DELETE FROM pending_connections WHERE owner_id = ?").bind(owner),
      this.db.prepare("DELETE FROM oauth_transactions WHERE owner_id = ?").bind(owner),
      this.db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL").bind(now(), owner),
    ]);
  }
  async limit(key: string, maximum: number, windowMs = 60_000): Promise<void> {
    const start = Math.floor(now() / windowMs) * windowMs;
    const row = await this.db.prepare(`INSERT INTO rate_limits (key, window_start, count) VALUES (?, ?, 1)
      ON CONFLICT(key) DO UPDATE SET count = CASE WHEN rate_limits.window_start = excluded.window_start THEN count + 1 ELSE 1 END,
      window_start = excluded.window_start RETURNING count`).bind(key, start).first<{ count: number }>();
    if (!row || row.count > maximum) throw new AppError("rate_limited", 429, "Too many requests. Try again shortly.", Math.ceil((start + windowMs - now()) / 1000));
  }
  async cleanup(): Promise<void> {
    await this.db.batch([
      this.db.prepare("DELETE FROM oauth_transactions WHERE expires_at <= ?").bind(now()),
      this.db.prepare("DELETE FROM pending_connections WHERE expires_at <= ?").bind(now()),
      this.db.prepare("DELETE FROM rate_limits WHERE window_start < ?").bind(now() - 86_400_000),
      // Pilot policy: remove expired/revoked personal-token metadata after 30 days.
      this.db.prepare("DELETE FROM api_tokens WHERE expires_at < ? OR revoked_at < ?").bind(now() - 30 * 86_400_000, now() - 30 * 86_400_000),
    ]);
  }
}
