import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { readFile } from "node:fs/promises";
import { createToken, listTokens, resolveOwner } from "../src/auth";
import { decrypt, encrypt, hash, random } from "../src/crypto";
import { Graph, validateGraphUrl } from "../src/graph";
import { beginOAuth, confirmReplacement, finishOAuth } from "../src/oauth";
import { Store } from "../src/store";
import { accessToken } from "../src/token-manager";
import { graphFields, toUTC } from "../src/task-fields";
import { createSchema, updateSchema } from "../src/tool-schemas";
import { handleRequest } from "../src/worker";
import type { Candidate, Dependencies, Env, Owner } from "../src/types";

let miniflare: Miniflare;
let env: Env;
let store: Store;
const alice: Owner = { id: "alice", permission: "write" };
const bob: Owner = { id: "bob", permission: "write" };
const task = { id: "task-1", title: "Test task", status: "notStarted", importance: "normal", body: { contentType: "html", content: "Task content" } };
const upstream = () => vi.fn<typeof fetch>(async () => Response.json({ value: [] }));
const identity = async () => ({ subject: "ms-alice", label: "Alice Microsoft" });
const tokenResponse = (access = "access-new", refresh = "refresh-new") => Response.json({ access_token: access, refresh_token: refresh, token_type: "Bearer", scope: "Tasks.ReadWrite openid profile", expires_in: 3600, id_token: "identity-token" });
function request(path: string, method = "GET", body?: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://todo.example${path}`, { method, headers: { ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers }, body: body !== undefined ? JSON.stringify(body) : undefined });
}
function browser(path: string, body: unknown, owner = "alice", extra: Record<string, string> = {}) {
  return request(path, "POST", body, { "oai-authenticated-user-id": owner, Origin: "https://todo.example", ...extra });
}
async function rpc(method: string, params?: unknown, headers: Record<string, string> = {}, deps: Dependencies = { fetch: upstream() }) {
  return handleRequest(request("/mcp", "POST", { jsonrpc: "2.0", id: 1, method, ...(params !== undefined ? { params } : {}) }, { Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25", ...headers }), env, deps);
}
async function connect(owner = "alice", expired = false, subject = `ms-${owner}`) {
  const generation = await store.ensureUser(owner);
  const candidate: Candidate = { id: crypto.randomUUID(), subject, label: `${owner} Microsoft`, cache: { accessToken: `access-${owner}`, refreshToken: `refresh-${owner}`, scopes: ["Tasks.ReadWrite"], expiresAt: Date.now() + (expired ? -1000 : 3_600_000) } };
  await store.applyConnection(owner, generation, candidate, false);
  return candidate;
}

beforeAll(async () => {
  miniflare = new Miniflare({ modules: true, script: "export default { fetch() { return new Response('ok') } }", d1Databases: ["DB"], cf: false });
  const db = await miniflare.getD1Database("DB");
  const migration = await readFile(new URL("../drizzle/0000_cool_tomorrow_man.sql", import.meta.url), "utf8");
  for (const sql of migration.split("--> statement-breakpoint")) if (sql.trim()) await db.prepare(sql.trim()).run();
  env = { DB: db as unknown as D1Database, PUBLIC_BASE_URL: "https://todo.example", MICROSOFT_CLIENT_ID: "client-id", MICROSOFT_CLIENT_SECRET: "test-secret",
    TOKEN_ENCRYPTION_KEY_ID: "test-v1", TOKEN_ENCRYPTION_KEYS: JSON.stringify({ "test-v1": random() }), MICROSOFT_OAUTH_ENABLED: "true", TRUST_SITES_IDENTITY_HEADERS: "true" };
  store = new Store(env);
});
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const table of ["oauth_transactions", "pending_connections", "microsoft_connections", "api_tokens", "rate_limits", "users"]) await env.DB.prepare(`DELETE FROM ${table}`).run();
});
afterAll(async () => { await miniflare.dispose(); });

describe("credential protection", () => {
  it("uses randomized encryption and rejects tampering and ownership/key changes", async () => {
    const first = await encrypt(env, "connection:alice:id", { access: "credential" });
    const second = await encrypt(env, "connection:alice:id", { access: "credential" });
    expect(first).not.toEqual(second);
    expect(first).not.toContain("credential");
    expect(await decrypt(env, "connection:alice:id", first)).toEqual({ access: "credential" });
    await expect(decrypt(env, "connection:bob:id", first)).rejects.toMatchObject({ code: "encryption_unavailable" });
    const envelope = JSON.parse(first); envelope.data = (envelope.data[0] === "A" ? "B" : "A") + envelope.data.slice(1);
    await expect(decrypt(env, "connection:alice:id", JSON.stringify(envelope))).rejects.toMatchObject({ code: "encryption_unavailable" });
    await expect(decrypt({ ...env, TOKEN_ENCRYPTION_KEYS: "{}" }, "connection:alice:id", first)).rejects.toMatchObject({ code: "encryption_unavailable" });
  });
  it("can decrypt an old key after active-key rotation", async () => {
    const cipher = await encrypt(env, "owner:alice", "cache");
    const rotated = { ...env, TOKEN_ENCRYPTION_KEY_ID: "v2", TOKEN_ENCRYPTION_KEYS: JSON.stringify({ ...JSON.parse(env.TOKEN_ENCRYPTION_KEYS!), v2: random() }) };
    expect(await decrypt(rotated, "owner:alice", cipher)).toBe("cache");
    expect(JSON.parse(await encrypt(rotated, "owner:alice", "new-cache")).kid).toBe("v2");
  });
  it("stores only personal token verifiers and owner-scoped metadata", async () => {
    const issued = await createToken(store, "alice", "Alice agent", "read", 90);
    await createToken(store, "bob", "Bob agent", "write", 30);
    const stored = await env.DB.prepare("SELECT * FROM api_tokens WHERE id = ?").bind(issued.id).first();
    expect(stored?.verifier).toBe(await hash(issued.token));
    expect(JSON.stringify(stored)).not.toContain(issued.token);
    const list = await listTokens(store, "alice");
    expect(list).toHaveLength(1); expect(list[0].label).toBe("Alice agent");
    expect(JSON.stringify(list)).not.toContain("verifier");
    expect((await resolveOwner(request("/mcp", "GET", undefined, { "X-MCP-API-Key": issued.token }), env, store)).id).toBe("alice");
  });
  it("rejects revoked, expired, invalid and contradictory credentials", async () => {
    const issued = await createToken(store, "alice", "Agent", "read", 90);
    const keyed = (token: string, managed?: string) => request("/mcp", "GET", undefined, { "X-MCP-API-Key": token, ...(managed ? { "oai-authenticated-user-id": managed } : {}) });
    await expect(resolveOwner(keyed(issued.token, "bob"), env, store)).rejects.toMatchObject({ code: "conflicting_credentials" });
    const last = issued.token.at(-1) === "A" ? "B" : "A";
    await expect(resolveOwner(keyed(issued.token.slice(0, -1) + last), env, store)).rejects.toMatchObject({ code: "invalid_api_token" });
    await env.DB.prepare("UPDATE api_tokens SET expires_at = ? WHERE id = ?").bind(Date.now() - 1000, issued.id).run();
    await expect(resolveOwner(keyed(issued.token), env, store)).rejects.toMatchObject({ code: "invalid_api_token" });
    await env.DB.prepare("UPDATE api_tokens SET expires_at = ?, revoked_at = ? WHERE id = ?").bind(Date.now() + 100_000, Date.now(), issued.id).run();
    await expect(resolveOwner(keyed(issued.token), env, store)).rejects.toMatchObject({ code: "invalid_api_token" });
  });
  it("fails closed on spoofed managed headers until the trust boundary is explicitly enabled", async () => {
    const response = await handleRequest(request("/api/settings", "GET", undefined, { "oai-authenticated-user-id": "alice" }), { ...env, TRUST_SITES_IDENTITY_HEADERS: "false" });
    expect(response.status).toBe(401);
    const settings = await handleRequest(request("/settings", "GET", undefined, { "oai-authenticated-user-id": "alice" }), { ...env, TRUST_SITES_IDENTITY_HEADERS: "false" });
    expect(settings.status).toBe(303); expect(settings.headers.get("Location")).toContain("/signin-with-chatgpt");
  });
});

describe("browser controls", () => {
  it("requires a signed-in browser and exact origin for issuance", async () => {
    expect((await handleRequest(browser("/api/tokens", { label: "Agent" }, "alice", { Origin: "https://evil.example" }), env)).status).toBe(403);
    expect((await handleRequest(request("/api/tokens", "POST", { label: "Agent" }, { Origin: "https://todo.example" }), env)).status).toBe(401);
    const issued = await createToken(store, "alice", "Agent", "write", 90);
    expect((await handleRequest(browser("/api/tokens", { label: "Another" }, "alice", { "X-MCP-API-Key": issued.token }), env)).status).toBe(401);
  });
  it("checks Microsoft access for the signed-in browser without returning list data", async () => {
    await connect("alice");
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ value: [{ id: "private-list", displayName: "Private list" }] }));
    const response = await handleRequest(browser("/api/check-access", {}), env, { fetch: fetcher });
    expect(response.status).toBe(200);
    const data = await response.json() as any;
    expect(data).toEqual({ verified: true });
    expect(JSON.stringify(data)).not.toContain("private-list");
    expect(String(fetcher.mock.calls[0][0])).toBe("https://graph.microsoft.com/v1.0/me/todo/lists");
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("Authorization")).toBe("Bearer access-alice");
  });
  it("rejects anonymous and cross-origin Microsoft access checks before Graph access", async () => {
    const fetcher = upstream();
    const anonymous = await handleRequest(request("/api/check-access", "POST", {}, { Origin: "https://todo.example" }), env, { fetch: fetcher });
    expect(anonymous.status).toBe(401);
    const crossOrigin = await handleRequest(browser("/api/check-access", {}, "alice", { Origin: "https://evil.example" }), env, { fetch: fetcher });
    expect(crossOrigin.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("defaults to read-only and 90-day expiry, rejects extra owner fields", async () => {
    const response = await handleRequest(browser("/api/tokens", { label: "Agent" }), env);
    expect(response.status).toBe(201); const data = await response.json() as any;
    expect(data.permission).toBe("read"); expect(data.expiresAt - data.createdAt).toBe(90 * 86_400_000);
    expect((await handleRequest(browser("/api/tokens", { label: "Agent", user_id: "bob" }), env)).status).toBe(400);
    expect((await handleRequest(browser("/api/tokens", { label: "Agent", days: 366 }), env)).status).toBe(400);
  });
  it("cannot revoke another owner's token and can revoke all owned tokens", async () => {
    const a = await createToken(store, "alice", "A", "read", 90); const b = await createToken(store, "bob", "B", "read", 90);
    expect((await handleRequest(browser(`/api/tokens/${b.id}/revoke`, {}), env)).status).toBe(404);
    expect((await handleRequest(browser("/api/tokens/revoke-all", {}), env)).status).toBe(200);
    await expect(resolveOwner(request("/mcp", "GET", undefined, { "X-MCP-API-Key": a.token }), env, store)).rejects.toMatchObject({ code: "invalid_api_token" });
    expect((await resolveOwner(request("/mcp", "GET", undefined, { "X-MCP-API-Key": b.token }), env, store)).id).toBe("bob");
  });
  it("rejects state-changing GET and bounds streaming request bodies", async () => {
    expect((await handleRequest(request("/api/microsoft/connect", "GET", undefined, { "oai-authenticated-user-id": "alice" }), env)).status).toBe(405);
    const large = await handleRequest(browser("/api/tokens", { label: "X".repeat(40_000) }), env);
    expect(large.status).toBe(413);
  });
  it("escapes identity display and keeps task/credential values out of public pages", async () => {
    await connect();
    const response = await handleRequest(request("/settings", "GET", undefined, { "oai-authenticated-user-id": "alice", "oai-authenticated-user-email": '<img src=x onerror="alert(1)">' }), env);
    const html = await response.text();
    expect(html).toContain("&lt;img"); expect(html).not.toContain('<img src=x'); expect(html).not.toContain("access-alice");
    expect(response.headers.get("Cache-Control")).toBe("no-store"); expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  });
});

describe("Microsoft authorization transactions", () => {
  it("binds PKCE/state to the owner, encrypts the verifier and consumes it once", async () => {
    const authorization = new URL(await beginOAuth(store, "alice", "connect"));
    expect(authorization.hostname).toBe("login.microsoftonline.com"); expect(authorization.pathname).toContain("consumers");
    expect(authorization.searchParams.get("redirect_uri")).toBe("https://todo.example/api/ms/oauth-return");
    expect(authorization.searchParams.get("code_challenge_method")).toBe("S256"); expect(authorization.searchParams.get("scope")).not.toContain("User.Read");
    const state = authorization.searchParams.get("state")!;
    const transaction = await env.DB.prepare("SELECT * FROM oauth_transactions WHERE state_hash = ?").bind(await hash(state)).first<any>();
    expect(JSON.stringify(transaction)).not.toContain(state);
    const verifier = await decrypt<string>(env, `oauth:alice:${transaction.state_hash}`, transaction.encrypted_verifier);
    expect(await hash(verifier)).toBe(authorization.searchParams.get("code_challenge"));
    const callback = new URL(`https://todo.example/api/ms/oauth-return?state=${state}&code=code`);
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      const fields = new URLSearchParams(String(init?.body)); expect(fields.get("code_verifier")).toBe(verifier); return tokenResponse();
    });
    await expect(finishOAuth(store, "bob", callback, { fetch: fetcher, validateIdentity: identity })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await finishOAuth(store, "alice", callback, { fetch: fetcher, validateIdentity: identity })).toBe("connected");
    await expect(finishOAuth(store, "alice", callback, { fetch: fetcher, validateIdentity: identity })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const connection = await store.connection("alice"); expect(connection?.subject).toBe("ms-alice");
    expect(connection?.encrypted_cache).not.toContain("access-new");
  });
  it("rejects expired and duplicate state before contacting Microsoft", async () => {
    const auth = new URL(await beginOAuth(store, "alice", "connect")); const state = auth.searchParams.get("state")!; const fetcher = upstream();
    await env.DB.prepare("UPDATE oauth_transactions SET expires_at = ?").bind(Date.now() - 1000).run();
    await expect(finishOAuth(store, "alice", new URL(`https://todo.example/api/ms/oauth-return?state=${state}&code=x`), { fetch: fetcher })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    await expect(finishOAuth(store, "alice", new URL(`https://todo.example/api/ms/oauth-return?state=${state}&state=${state}&code=x`), { fetch: fetcher })).rejects.toMatchObject({ code: "invalid_oauth_state" });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("preserves an existing connection on cancellation or rejected identity", async () => {
    const original = await connect();
    const auth = new URL(await beginOAuth(store, "alice", "replace"));
    expect(await finishOAuth(store, "alice", new URL(`https://todo.example/api/ms/oauth-return?state=${auth.searchParams.get("state")}&error=access_denied`), { fetch: upstream() })).toBe("cancelled");
    const auth2 = new URL(await beginOAuth(store, "alice", "replace"));
    await expect(finishOAuth(store, "alice", new URL(`https://todo.example/api/ms/oauth-return?state=${auth2.searchParams.get("state")}&code=x`), { fetch: vi.fn(async () => tokenResponse()), validateIdentity: async () => { throw new Error("invalid identity"); } })).rejects.toThrow();
    expect((await store.connection("alice"))?.id).toBe(original.id);
  });
  it("requires confirmation to replace an account and revokes personal tokens", async () => {
    const original = await connect(); const issued = await createToken(store, "alice", "Agent", "write", 90);
    const auth = new URL(await beginOAuth(store, "alice", "replace"));
    expect(await finishOAuth(store, "alice", new URL(`https://todo.example/api/ms/oauth-return?state=${auth.searchParams.get("state")}&code=x`), { fetch: vi.fn(async () => tokenResponse()), validateIdentity: async () => ({ subject: "different-account", label: "New account" }) })).toBe("confirm_replacement");
    expect((await store.connection("alice"))?.id).toBe(original.id);
    const pending = await env.DB.prepare("SELECT id FROM pending_connections WHERE owner_id = 'alice'").first<{ id: string }>();
    await expect(confirmReplacement(store, "bob", pending!.id)).rejects.toMatchObject({ code: "replacement_expired" });
    await confirmReplacement(store, "alice", pending!.id);
    expect((await store.connection("alice"))?.subject).toBe("different-account");
    await expect(resolveOwner(request("/mcp", "GET", undefined, { "X-MCP-API-Key": issued.token }), env, store)).rejects.toMatchObject({ code: "invalid_api_token" });
  });
  it("disconnect fences an in-flight callback and prevents credential resurrection", async () => {
    await connect(); const auth = new URL(await beginOAuth(store, "alice", "reconnect"));
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const finishing = finishOAuth(store, "alice", new URL(`https://todo.example/api/ms/oauth-return?state=${auth.searchParams.get("state")}&code=x`), { fetch: vi.fn(async () => { entered(); await waiting; return tokenResponse(); }), validateIdentity: identity });
    await started; await store.disconnect("alice"); release();
    await expect(finishing).rejects.toMatchObject({ code: "connection_changed" });
    expect(await store.connection("alice")).toBeNull();
  });
  it("does not leak authorization codes or provider errors in callback responses/logs", async () => {
    const log = vi.spyOn(console, "warn").mockImplementation(() => {});
    const response = await handleRequest(request("/api/ms/oauth-return?state=bad&code=secret-code&error_description=secret-error", "GET", undefined, { "oai-authenticated-user-id": "alice" }), env);
    expect(response.status).toBe(303); expect(response.headers.get("Location")).toBe(`https://todo.example/settings?notice=callback_failed&reference=${response.headers.get("X-Correlation-Id")}`);
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-code"); expect(JSON.stringify(log.mock.calls)).not.toContain("secret-error");
  });
});

describe("refresh coordination", () => {
  it("refreshes once, persists rotated refresh material and serves the new access token", async () => {
    const original = await connect("alice", true); const fetcher = vi.fn<typeof fetch>(async () => tokenResponse());
    expect((await accessToken(store, "alice", fetcher)).token).toBe("access-new");
    expect((await accessToken(store, "alice", fetcher)).token).toBe("access-new"); expect(fetcher).toHaveBeenCalledTimes(1);
    const row = await store.connection("alice"); const cache = await decrypt<any>(env, `connection:alice:${original.id}`, row!.encrypted_cache);
    expect(cache.refreshToken).toBe("refresh-new"); expect(row?.cache_version).toBe(1); expect(row?.lease_id).toBeNull();
  });
  it("only one concurrent request refreshes and expired leases are recoverable", async () => {
    await connect("alice", true);
    let release!: () => void; const waiting = new Promise<void>(resolve => { release = resolve; });
    let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    const fetcher = vi.fn<typeof fetch>(async () => { entered(); await waiting; return tokenResponse(); });
    const first = accessToken(store, "alice", fetcher); await started;
    await expect(accessToken(store, "alice", fetcher)).rejects.toMatchObject({ code: "refresh_in_progress" });
    release(); await first; expect(fetcher).toHaveBeenCalledTimes(1);
    await connect("bob", true); await env.DB.prepare("UPDATE microsoft_connections SET lease_id = 'crashed', lease_until = ? WHERE owner_id = 'bob'").bind(Date.now() - 1000).run();
    expect((await accessToken(store, "bob", vi.fn(async () => tokenResponse()))).token).toBe("access-new");
  });
  it("marks permanent revocation as reconnect-required but preserves transient failures", async () => {
    await connect("alice", true); const permanent = vi.fn<typeof fetch>(async () => Response.json({ error: "invalid_grant", error_description: "private diagnostic" }, { status: 400 }));
    await expect(accessToken(store, "alice", permanent)).rejects.toMatchObject({ code: "reconnect_required" });
    expect((await store.connection("alice"))?.status).toBe("reconnect_required");
    await connect("bob", true); const before = await store.connection("bob");
    await expect(accessToken(store, "bob", vi.fn(async () => { throw new Error("timeout"); }))).rejects.toMatchObject({ code: "microsoft_unavailable" });
    const after = await store.connection("bob"); expect(after?.status).toBe("connected"); expect(after?.encrypted_cache).toBe(before?.encrypted_cache); expect(after?.lease_id).toBeNull();
  });
  it("does not overwrite or return refreshed credentials after a disconnect", async () => {
    await connect("alice", true);
    const fetcher = vi.fn<typeof fetch>(async () => { await store.disconnect("alice"); return tokenResponse(); });
    await expect(accessToken(store, "alice", fetcher)).rejects.toMatchObject({ code: "connection_changed" }); expect(await store.connection("alice")).toBeNull();
  });
});

describe("Graph and MCP authorization", () => {
  it("initializes/discovers eight tools anonymously without exposing user data", async () => {
    await connect();
    const init = await rpc("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test-client", version: "1.0" } });
    expect(init.status).toBe(200); expect(init.headers.has("Mcp-Session-Id")).toBe(false);
    const discovered = await rpc("tools/list"); expect(discovered.status).toBe(200); const data = await discovered.json() as any;
    expect(data.result.tools).toHaveLength(8); expect(JSON.stringify(data)).not.toContain("alice"); expect(JSON.stringify(data)).not.toContain("access-");
    expect(data.result.tools.find((t: any) => t.name === "todo_delete_task").annotations.destructiveHint).toBe(true);
  });
  it("rejects anonymous data calls and read-only writes before Graph requests", async () => {
    await connect(); const fetcher = upstream();
    expect((await rpc("tools/call", { name: "todo_connection_status", arguments: {} }, {}, { fetch: fetcher })).status).toBe(401);
    const issued = await createToken(store, "alice", "Read agent", "read", 90);
    expect((await rpc("tools/call", { name: "todo_create_task", arguments: { listId: "list", task: { title: "Write" } } }, { "X-MCP-API-Key": issued.token }, { fetch: fetcher })).status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("both managed and personal-token paths resolve to the correct isolated Microsoft account", async () => {
    await connect("alice"); await connect("bob"); const issued = await createToken(store, "bob", "Agent", "read", 90);
    const seen: string[] = [];
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => { seen.push(new Headers(init?.headers).get("Authorization")!); return Response.json({ value: [{ id: "list", displayName: "Tasks" }] }); });
    const a = await rpc("tools/call", { name: "todo_list_lists", arguments: {} }, { "oai-authenticated-user-id": "alice" }, { fetch: fetcher });
    const b = await rpc("tools/call", { name: "todo_list_lists", arguments: {} }, { "X-MCP-API-Key": issued.token }, { fetch: fetcher });
    expect((await a.json() as any).result.structuredContent.items).toHaveLength(1); expect((await b.json() as any).result.structuredContent.items).toHaveLength(1);
    expect(seen).toEqual(["Bearer access-alice", "Bearer access-bob"]);
  });
  it("rejects owner arguments and unknown task fields instead of stripping them", async () => {
    await connect(); const fetcher = upstream();
    const forged = await rpc("tools/call", { name: "todo_list_lists", arguments: { user_id: "bob" } }, { "oai-authenticated-user-id": "alice" }, { fetch: fetcher });
    expect((await forged.json() as any).result.isError).toBe(true);
    const write = await rpc("tools/call", { name: "todo_create_task", arguments: { listId: "list", task: { title: "Task", url: "https://evil.example" } } }, { "oai-authenticated-user-id": "alice" }, { fetch: fetcher });
    expect((await write.json() as any).result.isError).toBe(true); expect(fetcher).not.toHaveBeenCalled();
  });
  it("returns an actionable Settings response when Microsoft is not connected", async () => {
    const response = await rpc("tools/call", { name: "todo_list_lists", arguments: {} }, { "oai-authenticated-user-id": "alice" });
    const data = await response.json() as any; expect(data.result.isError).toBe(true); expect(data.result.structuredContent.error.code).toBe("not_connected"); expect(data.result.structuredContent.settingsUrl).toBe("https://todo.example/settings");
  });
  it("binds pagination to the owner, path and connection, and blocks foreign destinations", async () => {
    await connect("alice"); await connect("bob"); const fetcher = vi.fn<typeof fetch>(async () => Response.json({ value: [task], "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/todo/lists/list/tasks?$skiptoken=opaque" }));
    const graph = new Graph(store, alice, fetcher); const page = await graph.listTasks("list", 25); expect(page.nextCursor).toBeTruthy(); expect(page.nextCursor).not.toContain("skiptoken");
    await graph.listTasks("list", 25, page.nextCursor);
    await expect(new Graph(store, bob, fetcher).listTasks("list", 25, page.nextCursor)).rejects.toMatchObject({ code: "invalid_cursor" });
    await expect(graph.listTasks("other-list", 25, page.nextCursor)).rejects.toMatchObject({ code: "invalid_cursor" });
    await connect("alice"); await expect(graph.listTasks("list", 25, page.nextCursor)).rejects.toMatchObject({ code: "invalid_cursor" });
    expect(() => validateGraphUrl("https://evil.example/v1.0/me/todo/lists", "/v1.0/me/todo/lists")).toThrow();
    expect(() => validateGraphUrl("https://graph.microsoft.com/v1.0/users/bob/todo/lists", "/v1.0/me/todo/lists")).toThrow();
    expect(() => validateGraphUrl("https://attacker@graph.microsoft.com/v1.0/me/todo/lists", "/v1.0/me/todo/lists")).toThrow();
  });
  it("encodes resource IDs, uses only /me endpoints and never follows redirects", async () => {
    await connect(); const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://graph.microsoft.com/v1.0/me/todo/lists/a%2Fb%3F%23/tasks/task%2Fid"); expect(init?.redirect).toBe("manual"); return Response.json(task);
    });
    await new Graph(store, alice, fetcher).getTask("a/b?#", "task/id"); expect(fetcher).toHaveBeenCalledOnce();
  });
  it("does not retry ambiguous creation or expose provider error bodies", async () => {
    await connect(); const fetcher = vi.fn<typeof fetch>(async () => { throw new Error("credential=secret"); });
    await expect(new Graph(store, alice, fetcher).createTask("list", { title: "New" })).rejects.toMatchObject({ code: "write_outcome_unknown" }); expect(fetcher).toHaveBeenCalledTimes(1);
    const rejected = vi.fn<typeof fetch>(async () => Response.json({ error: { message: "Private task and secret" } }, { status: 403 }));
    await expect(new Graph(store, alice, rejected).getTask("list", "task")).rejects.toMatchObject({ code: "graph_access_denied", message: expect.not.stringContaining("secret") });
  });
  it("reports an uncertain write when a successful response contains an unusable task", async () => {
    await connect(); const fetcher = vi.fn<typeof fetch>(async () => Response.json({ unexpected: "response" }, { status: 201 }));
    await expect(new Graph(store, alice, fetcher).createTask("list", { title: "New" })).rejects.toMatchObject({ code: "write_outcome_unknown" });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not mark a newly refreshed cache revoked because an older request received 401", async () => {
    await connect();
    const fetcher = vi.fn<typeof fetch>(async () => {
      await env.DB.prepare("UPDATE microsoft_connections SET cache_version = cache_version + 1 WHERE owner_id = 'alice'").run();
      return new Response(null, { status: 401 });
    });
    await expect(new Graph(store, alice, fetcher).getTask("list", "task")).rejects.toMatchObject({ code: "reconnect_required" });
    expect((await store.connection("alice"))?.status).toBe("connected");
  });
  it("respects throttling and bounds read retries/results", async () => {
    await connect(); const fetcher = vi.fn<typeof fetch>(async () => new Response(null, { status: 429, headers: { "Retry-After": "60" } }));
    await expect(new Graph(store, alice, fetcher).listLists(25)).rejects.toMatchObject({ code: "graph_rate_limited", retryAfter: 60 }); expect(fetcher).toHaveBeenCalledTimes(1);
    const oversized = vi.fn<typeof fetch>(async () => Response.json({ value: Array.from({ length: 26 }, () => ({ id: "id", displayName: "Tasks" })) }));
    await expect(new Graph(store, alice, oversized).listLists(25)).rejects.toMatchObject({ code: "graph_unavailable" });
  });
  it("rejects cross-origin MCP requests and enforces per-owner rate limits", async () => {
    const response = await rpc("tools/list", undefined, { Origin: "https://evil.example" }); expect(response.status).toBe(403);
    await store.limit("key", 1); await expect(store.limit("key", 1)).rejects.toMatchObject({ code: "rate_limited" });
  });
});

describe("task representation", () => {
  it("rejects missing/ambiguous date semantics and unsupported fields", () => {
    expect(createSchema.safeParse({ title: "Task", dueDateTime: { dateTime: "2026-10-02" } }).success).toBe(false);
    expect(createSchema.safeParse({ title: "Task", dueDateTime: { dateTime: "2026-02-30T12:00:00", timeZone: "UTC" } }).success).toBe(false);
    expect(updateSchema.safeParse({}).success).toBe(false);
    expect(updateSchema.safeParse({ status: "unknown" }).success).toBe(false);
  });
  it("converts explicit IANA dates to UTC and rejects DST gaps/overlaps", () => {
    expect(toUTC({ dateTime: "2026-10-02T15:00:00", timeZone: "Europe/Istanbul" })).toEqual({ dateTime: "2026-10-02T12:00:00", timeZone: "UTC" });
    expect(toUTC({ dateTime: "2026-10-02T09:00:00.1234567", timeZone: "Asia/Kolkata" })).toEqual({ dateTime: "2026-10-02T03:30:00.1234567", timeZone: "UTC" });
    expect(() => toUTC({ dateTime: "2026-03-08T02:30:00", timeZone: "America/New_York" })).toThrow();
    expect(() => toUTC({ dateTime: "2026-11-01T01:30:00", timeZone: "America/New_York" })).toThrow();
    expect(graphFields({ body: { contentType: "text", content: '<script>\n&"' } })).toEqual({ body: { contentType: "html", content: "&lt;script&gt;<br>&amp;&quot;" } });
  });
});
