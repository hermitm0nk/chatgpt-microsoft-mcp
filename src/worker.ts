import { z } from "zod";
import { browserOwner, createToken, listTokens, managedOwner } from "./auth";
import { baseUrl, settingsUrl } from "./config";
import { errorResponse, failure, json } from "./errors";
import { noRedirect, protectBrowserWrite, readJson } from "./http";
import { Graph } from "./graph";
import { mcp } from "./mcp";
import { beginOAuth, finishOAuth, confirmReplacement, pendingConnection } from "./oauth";
import { CLIENT_SCRIPT } from "./portal-client";
import { CSS, landing, privacy, settings } from "./portal";
import { now, Store } from "./store";
import { measure } from "./telemetry";
import type { Dependencies, Env } from "./types";

const empty = z.object({}).strict();
export async function handleRequest(request: Request, env: Env, deps: Dependencies = { fetch }): Promise<Response> {
  const correlationId = crypto.randomUUID();
  const url = new URL(request.url);
  try {
    const response = await route(request, url, new Store(env), deps);
    return secure(response, correlationId);
  } catch (error) {
    const response = errorResponse(error, correlationId);
    if (url.pathname === "/api/ms/oauth-return") {
      const code = failure(error).code;
      const notice = response.status === 401 ? "browser_auth_required" : ["configuration_required", "microsoft_unavailable"].includes(code) ? code : "callback_failed";
      return secure(noRedirect(`${settingsUrl(env)}?notice=${notice}&reference=${correlationId}`), correlationId);
    }
    return secure(response, correlationId);
  }
}
async function route(request: Request, url: URL, store: Store, deps: Dependencies): Promise<Response> {
  const env = store.env;
  const path = url.pathname;
  if (path === "/health" && request.method === "GET") return json({ ok: true });
  if (path === "/mcp") return mcp(request, store, deps);
  if (path === "/api/check-access") {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: "POST" } });
    const owner = browserOwner(request, env);
    protectBrowserWrite(request, env);
    await store.limit(`settings:check:${owner.id}`, 20);
    await readJson(request, empty);
    await new Graph(store, owner, deps.fetch).listLists(1);
    return json({ verified: true });
  }
  if (request.method === "GET") {
    if (path === "/") return landing();
    if (path === "/privacy") return privacy();
    if (path === "/assets/portal.css") return new Response(CSS, { headers: { "Content-Type": "text/css; charset=utf-8", "Cache-Control": "public,max-age=300" } });
    if (path === "/assets/settings.js") return new Response(CLIENT_SCRIPT, { headers: { "Content-Type": "text/javascript; charset=utf-8", "Cache-Control": "public,max-age=300" } });
    if (path === "/settings") {
      const owner = managedOwner(request, env);
      if (!owner) return noRedirect("/signin-with-chatgpt?return_to=%2Fsettings");
      return settings(owner.email || "your ChatGPT account", url.searchParams.get("notice") || undefined, url.searchParams.get("reference") || undefined);
    }
    if (path === "/api/ms/oauth-return") {
      const owner = browserOwner(request, env);
      const result = await finishOAuth(store, owner.id, url, deps);
      measure({ event: "microsoft_authorization", outcome: result });
      return noRedirect(`${settingsUrl(env)}?notice=${result}`);
    }
    if (path === "/api/settings" || path === "/api/tokens") {
      const owner = browserOwner(request, env);
      await store.limit(`settings:${owner.id}`, 120);
      await store.cleanup();
      const tokens = await listTokens(store, owner.id);
      if (path === "/api/tokens") return json({ tokens });
      const connection = await store.connection(owner.id);
      return json({ connection: { state: connection?.status || "not_connected", accountLabel: connection?.label },
        tokens, pending: await pendingConnection(store, owner.id), mcpUrl: `${baseUrl(env)}/mcp` });
    }
  }
  const writable = ["/api/microsoft/connect", "/api/microsoft/disconnect", "/api/microsoft/confirm-replacement", "/api/microsoft/cancel-replacement", "/api/tokens", "/api/tokens/revoke-all"].includes(path) || /^\/api\/tokens\/[A-Za-z0-9_-]{16}\/revoke$/.test(path);
  if (writable) {
    if (request.method !== "POST") return new Response(null, { status: 405, headers: { Allow: path === "/api/tokens" ? "GET, POST" : "POST" } });
    const owner = browserOwner(request, env);
    protectBrowserWrite(request, env);
    await store.limit(`settings:write:${owner.id}`, 20);
    if (path === "/api/microsoft/connect") {
      const body = await readJson(request, z.object({ purpose: z.enum(["connect", "reconnect", "replace"]).default("connect") }).strict());
      return json({ authorizationUrl: await beginOAuth(store, owner.id, body.purpose) });
    }
    if (path === "/api/microsoft/confirm-replacement") {
      const body = await readJson(request, z.object({ pendingId: z.string().uuid() }).strict());
      await confirmReplacement(store, owner.id, body.pendingId);
      return json({ connected: true, personalTokensRevoked: true });
    }
    if (path === "/api/tokens") {
      const body = await readJson(request, z.object({ label: z.string().trim().min(1).max(80), permission: z.enum(["read", "write"]).default("read"), days: z.number().int().min(1).max(365).default(90) }).strict());
      return json(await createToken(store, owner.id, body.label, body.permission, body.days), 201);
    }
    await readJson(request, empty);
    if (path === "/api/microsoft/disconnect") { await store.disconnect(owner.id); return json({ disconnected: true, personalTokensRevoked: true }); }
    if (path === "/api/microsoft/cancel-replacement") { await store.db.prepare("DELETE FROM pending_connections WHERE owner_id = ?").bind(owner.id).run(); return json({ cancelled: true }); }
    if (path === "/api/tokens/revoke-all") { await store.db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE owner_id = ? AND revoked_at IS NULL").bind(now(), owner.id).run(); return json({ revoked: true }); }
    const id = path.split("/")[3];
    const revoked = await store.db.prepare("UPDATE api_tokens SET revoked_at = ? WHERE owner_id = ? AND id = ? AND revoked_at IS NULL").bind(now(), owner.id, id).run();
    return revoked.meta.changes ? json({ revoked: true }) : json({ error: { code: "token_not_found", message: "That token is unavailable." } }, 404);
  }
  return json({ error: { code: "not_found", message: "Route not found." } }, 404);
}
function secure(response: Response, correlationId: string): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("X-Correlation-Id", correlationId);
  headers.set("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'self'; object-src 'none'");
  return new Response(response.body, { status: response.status, headers });
}
export default {
  fetch(request: Request, env: Env) { return handleRequest(request, env); },
  async scheduled(_controller: ScheduledController, env: Env) { await new Store(env).cleanup(); },
};
