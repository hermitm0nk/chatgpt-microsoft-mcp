import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text("id").primaryKey(), createdAt: integer("created_at").notNull(),
  generation: integer("generation").notNull().default(0), mutationId: text("mutation_id"),
});

export const connections = sqliteTable("microsoft_connections", {
  ownerId: text("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  id: text("id").notNull().unique(), subject: text("subject").notNull(), label: text("label").notNull(),
  scopes: text("scopes").notNull(), encryptedCache: text("encrypted_cache").notNull(),
  status: text("status", { enum: ["connected", "reconnect_required"] }).notNull(),
  expiresAt: integer("expires_at").notNull(), cacheVersion: integer("cache_version").notNull().default(0),
  leaseId: text("lease_id"), leaseUntil: integer("lease_until"), updatedAt: integer("updated_at").notNull(),
});

export const oauthTransactions = sqliteTable("oauth_transactions", {
  stateHash: text("state_hash").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  generation: integer("generation").notNull(), purpose: text("purpose").notNull(),
  encryptedVerifier: text("encrypted_verifier").notNull(), nonce: text("nonce").notNull(),
  expiresAt: integer("expires_at").notNull(),
}, t => [index("oauth_expiry_idx").on(t.expiresAt)]);

export const pendingConnections = sqliteTable("pending_connections", {
  ownerId: text("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  id: text("id").notNull(), generation: integer("generation").notNull(),
  encryptedCandidate: text("encrypted_candidate").notNull(), label: text("label").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

export const apiTokens = sqliteTable("api_tokens", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  verifier: text("verifier").notNull(), label: text("label").notNull(),
  permission: text("permission", { enum: ["read", "write"] }).notNull(),
  createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
  revokedAt: integer("revoked_at"), lastUsedAt: integer("last_used_at"),
}, t => [index("token_owner_idx").on(t.ownerId)]);

export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(), windowStart: integer("window_start").notNull(),
  count: integer("count").notNull(),
});
