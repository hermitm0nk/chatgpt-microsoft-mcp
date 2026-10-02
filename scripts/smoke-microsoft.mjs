import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { Miniflare } from "miniflare";

// Synthetic upstreams only: no live Microsoft credentials or customer data.
const origin = "https://todo.example";
const tenant = "9188040d-6c67-4c5b-b112-36a304b66dad";
const { privateKey, publicKey } = await generateKeyPair("RS256");
const jwk = { ...await exportJWK(publicKey), kid: "worker-smoke", alg: "RS256", use: "sig" };
let nonce;
let tokenRedirect = false;
let keysRedirect = false;
let graphRedirect = false;
const calls = [];
const runtime = new Miniflare({ modules: true, scriptPath: "dist/worker.js", compatibilityDate: "2026-08-06",
  compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB"], cf: false,
  bindings: { PUBLIC_BASE_URL: origin, TRUST_SITES_IDENTITY_HEADERS: "true", MICROSOFT_OAUTH_ENABLED: "true",
    MICROSOFT_CLIENT_ID: "worker-client", MICROSOFT_CLIENT_SECRET: "synthetic-client-secret",
    TOKEN_ENCRYPTION_KEY_ID: "test", TOKEN_ENCRYPTION_KEYS: JSON.stringify({ test: randomBytes(32).toString("base64url") }) },
  outboundService: async request => {
    const url = new URL(request.url);
    calls.push({ host: url.host, path: url.pathname, method: request.method });
    const redirect = () => new Response(null, { status: 307, headers: { Location: "https://unexpected.example/credential-target" } });
    if (url.host === "login.microsoftonline.com" && url.pathname === "/consumers/oauth2/v2.0/token") {
      assert.equal(request.method, "POST");
      const fields = new URLSearchParams(await request.text());
      assert.equal(fields.get("client_secret"), "synthetic-client-secret");
      assert.ok(fields.get("code_verifier"));
      if (tokenRedirect) return redirect();
      const id_token = await new SignJWT({ sub: "synthetic-microsoft-subject", tid: tenant, nonce, name: "Worker smoke account" })
        .setProtectedHeader({ alg: "RS256", kid: jwk.kid }).setIssuer(`https://login.microsoftonline.com/${tenant}/v2.0`)
        .setAudience("worker-client").setIssuedAt().setExpirationTime("1h").sign(privateKey);
      return Response.json({ access_token: "synthetic-access", refresh_token: "synthetic-refresh", token_type: "Bearer",
        expires_in: 3600, scope: "Tasks.ReadWrite", id_token });
    }
    if (url.host === "login.microsoftonline.com" && url.pathname === `/${tenant}/discovery/v2.0/keys`) {
      if (keysRedirect) return redirect();
      return Response.json({ keys: [jwk] });
    }
    if (url.host === "graph.microsoft.com" && url.pathname === "/v1.0/me/todo/lists") {
      assert.equal(request.headers.get("Authorization"), "Bearer synthetic-access");
      if (graphRedirect) return redirect();
      return Response.json({ value: [{ id: "list-1", displayName: "Synthetic list" }] });
    }
    if (url.host === "graph.microsoft.com" && url.pathname === "/v1.0/me/todo/lists/list-1/tasks") {
      assert.equal(request.method, "POST");
      assert.equal(request.headers.get("Authorization"), "Bearer synthetic-access");
      return redirect();
    }
    assert.fail(`Unexpected outbound request: ${url.host}${url.pathname}`);
  },
});
const headers = { "oai-authenticated-user-id": "worker-owner" };
async function callback() {
  const start = await runtime.dispatchFetch(`${origin}/api/microsoft/connect`, { method: "POST",
    headers: { ...headers, Origin: origin, "Content-Type": "application/json" }, body: "{}" });
  assert.equal(start.status, 200);
  const auth = new URL((await start.json()).authorizationUrl);
  nonce = auth.searchParams.get("nonce");
  return runtime.dispatchFetch(`${origin}/api/ms/oauth-return?state=${auth.searchParams.get("state")}&code=synthetic-code`, { headers, redirect: "manual" });
}
async function rpc(name, args = {}) {
  const response = await runtime.dispatchFetch(`${origin}/mcp`, { method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) });
  assert.equal(response.status, 200);
  return (await response.json()).result;
}
try {
  const db = await runtime.getD1Database("DB");
  const migration = await readFile(new URL("../drizzle/0000_cool_tomorrow_man.sql", import.meta.url), "utf8");
  for (const sql of migration.split("--> statement-breakpoint")) if (sql.trim()) await db.prepare(sql.trim()).run();
  tokenRedirect = true;
  const rejectedToken = await callback();
  assert.match(rejectedToken.headers.get("Location"), /notice=microsoft_unavailable/);
  assert.equal(calls.length, 1, "Token redirects must not be followed");
  tokenRedirect = false;
  keysRedirect = true;
  const rejectedKeys = await callback();
  assert.match(rejectedKeys.headers.get("Location"), /notice=callback_failed/);
  assert.equal(calls.length, 3, "Signing-key redirects must not be followed");
  keysRedirect = false;
  const linked = await callback();
  assert.equal(linked.status, 303);
  assert.equal(linked.headers.get("Location"), `${origin}/settings?notice=connected`);
  const lists = await rpc("todo_list_lists");
  assert.notEqual(lists.isError, true, JSON.stringify({ result: lists, calls }));
  assert.equal(lists.structuredContent.items[0].displayName, "Synthetic list");
  graphRedirect = true;
  const beforeRead = calls.length;
  const redirectedRead = await rpc("todo_list_lists");
  assert.equal(redirectedRead.structuredContent.error.code, "graph_unavailable");
  assert.equal(calls.length, beforeRead + 1, "Graph redirects must not be followed or retried");
  const beforeWrite = calls.length;
  const redirectedWrite = await rpc("todo_create_task", { listId: "list-1", task: { title: "Synthetic task" } });
  assert.equal(redirectedWrite.structuredContent.error.code, "write_outcome_unknown");
  assert.equal(calls.length, beforeWrite + 1, "Writes must not be repeated or redirected");
  assert.ok(calls.every(call => ["login.microsoftonline.com", "graph.microsoft.com"].includes(call.host)));
  console.log("Microsoft Worker regression passed: token exchange, signed JWKS, Graph and credential redirect rejection.");
} finally { await runtime.dispose(); }
