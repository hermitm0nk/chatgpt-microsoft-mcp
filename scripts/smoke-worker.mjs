import assert from "node:assert/strict";
import { Miniflare } from "miniflare";

// Execute the actual bundled SDK/server in workerd, without external credentials.
const runtime = new Miniflare({ modules: true, scriptPath: "dist/worker.js", compatibilityDate: "2026-08-06",
  compatibilityFlags: ["nodejs_compat"], d1Databases: ["DB"], cf: false,
  bindings: { PUBLIC_BASE_URL: "https://todo.example", TRUST_SITES_IDENTITY_HEADERS: "false", MICROSOFT_OAUTH_ENABLED: "false" } });
try {
  const health = await runtime.dispatchFetch("https://todo.example/health");
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { ok: true });
  const discovery = await runtime.dispatchFetch("https://todo.example/mcp", { method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-11-25" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });
  assert.equal(discovery.status, 200);
  assert.equal((await discovery.json()).result.tools.length, 8);
  const spoof = await runtime.dispatchFetch("https://todo.example/api/settings", { headers: { "oai-authenticated-user-id": "spoofed" } });
  assert.equal(spoof.status, 401);
  console.log("Bundled Worker smoke passed: health, SDK discovery, fail-closed identity.");
} finally { await runtime.dispose(); }

// Exercise real outbound fetch, signed JWKS identity validation and Graph in workerd.
await import("./smoke-microsoft.mjs");
