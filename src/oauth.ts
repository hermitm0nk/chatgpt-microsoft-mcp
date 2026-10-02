import { z } from "zod";
import { encrypt, decrypt, random, hash } from "./crypto";
import { MICROSOFT_AUTHORITY, OAUTH_SCOPES, oauthReady, redirectUri } from "./config";
import { AppError } from "./errors";
import { codeFields, tokenRequest, validateIdentity } from "./microsoft";
import { now, Store } from "./store";
import type { Candidate, Dependencies, Env } from "./types";

interface Transaction { state_hash: string; owner_id: string; generation: number; purpose: string; encrypted_verifier: string; nonce: string; expires_at: number }
export async function beginOAuth(store: Store, owner: string, purpose: "connect" | "reconnect" | "replace"): Promise<string> {
  const env = store.env;
  oauthReady(env);
  await store.limit(`oauth:${owner}`, 5);
  await store.cleanup();
  const generation = await store.ensureUser(owner);
  const state = random();
  const verifier = random();
  const nonce = random();
  const stateHash = await hash(state);
  const encrypted = await encrypt(env, `oauth:${owner}:${stateHash}`, verifier);
  await store.db.prepare("INSERT INTO oauth_transactions (state_hash, owner_id, generation, purpose, encrypted_verifier, nonce, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(stateHash, owner, generation, purpose, encrypted, nonce, now() + 600_000).run();
  const url = new URL(`${MICROSOFT_AUTHORITY}/authorize`);
  url.search = new URLSearchParams({ client_id: env.MICROSOFT_CLIENT_ID, response_type: "code", response_mode: "query", redirect_uri: redirectUri(env),
    scope: OAUTH_SCOPES.join(" "), state, nonce, code_challenge: await hash(verifier), code_challenge_method: "S256", prompt: "select_account" }).toString();
  return url.toString();
}
export async function finishOAuth(store: Store, owner: string, url: URL, deps: Dependencies): Promise<"connected" | "cancelled" | "confirm_replacement"> {
  oauthReady(store.env);
  for (const field of ["state", "code", "error"]) if (url.searchParams.getAll(field).length > 1) throw new AppError("invalid_oauth_state", 400, "Authorization response is invalid. Start again from Settings.");
  const state = url.searchParams.get("state");
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state)) throw new AppError("invalid_oauth_state", 400, "Authorization state is invalid. Start again from Settings.");
  // DELETE RETURNING atomically consumes a valid, owner-bound transaction before any token request.
  const transaction = await store.db.prepare(`DELETE FROM oauth_transactions WHERE state_hash = ? AND owner_id = ? AND expires_at > ?
    AND generation = (SELECT generation FROM users WHERE id = ?) RETURNING *`).bind(await hash(state), owner, now(), owner).first<Transaction>();
  if (!transaction) throw new AppError("invalid_oauth_state", 400, "Authorization expired, was already used, or belongs to another session. Start again from Settings.");
  if (url.searchParams.has("error")) return "cancelled";
  const code = url.searchParams.get("code");
  if (!code || code.length > 8192) throw new AppError("invalid_authorization_code", 400, "Microsoft authorization was incomplete. Start again from Settings.");
  const verifier = await decrypt<string>(store.env, `oauth:${owner}:${transaction.state_hash}`, transaction.encrypted_verifier);
  const result = await tokenRequest(store.env, deps.fetch, codeFields(store.env, code, verifier));
  if (!result.idToken) throw new AppError("invalid_microsoft_identity", 400, "Microsoft identity could not be verified. Start again from Settings.");
  const identity = await (deps.validateIdentity || validateIdentity)(result.idToken, transaction.nonce, store.env);
  const current = await store.connection(owner);
  const candidate: Candidate = { id: crypto.randomUUID(), subject: identity.subject, label: identity.label, cache: result.cache };
  if (current && current.subject !== candidate.subject) {
    const encrypted = await encrypt(store.env, `pending:${owner}:${candidate.id}`, candidate);
    const pending = await store.db.prepare(`INSERT INTO pending_connections (owner_id, id, generation, encrypted_candidate, label, expires_at)
      SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND generation = ?)
      ON CONFLICT(owner_id) DO UPDATE SET id = excluded.id, generation = excluded.generation, encrypted_candidate = excluded.encrypted_candidate,
        label = excluded.label, expires_at = excluded.expires_at`)
      .bind(owner, candidate.id, transaction.generation, encrypted, candidate.label, now() + 600_000, owner, transaction.generation).run();
    if (!pending.meta.changes) throw new AppError("connection_changed", 409, "Your connection changed. Start again from Settings.");
    return "confirm_replacement";
  }
  await store.applyConnection(owner, transaction.generation, candidate, false);
  return "connected";
}
export async function pendingConnection(store: Store, owner: string) {
  return store.db.prepare("SELECT id, label, expires_at AS expiresAt FROM pending_connections WHERE owner_id = ? AND expires_at > ? AND generation = (SELECT generation FROM users WHERE id = ?)")
    .bind(owner, now(), owner).first();
}
const candidateSchema = z.object({ id: z.string(), subject: z.string(), label: z.string(), cache: z.object({ accessToken: z.string(), refreshToken: z.string(), expiresAt: z.number(), scopes: z.array(z.string()) }) });
export async function confirmReplacement(store: Store, owner: string, pendingId: string) {
  const pending = await store.db.prepare("SELECT * FROM pending_connections WHERE owner_id = ? AND id = ? AND expires_at > ?")
    .bind(owner, pendingId, now()).first<{ id: string; generation: number; encrypted_candidate: string }>();
  if (!pending) throw new AppError("replacement_expired", 409, "The replacement expired or was cancelled. Connect again from Settings.");
  const candidate = candidateSchema.parse(await decrypt(store.env, `pending:${owner}:${pending.id}`, pending.encrypted_candidate));
  await store.applyConnection(owner, pending.generation, candidate, true);
}
