import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { Miniflare } from "miniflare";

// Optional interoperability check with the Python SDK pinned by the inspected
// Hermes release. Only a loopback Worker and synthetic personal tokens are used.
const reservation = createServer();
await new Promise(resolve => reservation.listen(0, "127.0.0.1", resolve));
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const runtime = new Miniflare({ modules: true, scriptPath: "dist/worker.js", compatibilityDate: "2026-08-06",
  compatibilityFlags: ["nodejs_compat"], host: "127.0.0.1", port, d1Databases: ["DB"], cf: false,
  bindings: { PUBLIC_BASE_URL: origin, TRUST_SITES_IDENTITY_HEADERS: "true", MICROSOFT_OAUTH_ENABLED: "false",
    TOKEN_ENCRYPTION_KEY_ID: "test", TOKEN_ENCRYPTION_KEYS: JSON.stringify({ test: randomBytes(32).toString("base64url") }) },
  outboundService: () => { throw new Error("This interoperability check must not make upstream requests."); },
});
try {
  await runtime.ready;
  const db = await runtime.getD1Database("DB");
  const migration = await readFile(new URL("../drizzle/0000_cool_tomorrow_man.sql", import.meta.url), "utf8");
  for (const sql of migration.split("--> statement-breakpoint")) if (sql.trim()) await db.prepare(sql.trim()).run();
  const response = await runtime.dispatchFetch(`${origin}/api/tokens`, { method: "POST", headers: {
    "oai-authenticated-user-id": "python-test-owner", Origin: origin, "Content-Type": "application/json" },
    body: JSON.stringify({ label: "Synthetic SDK check", permission: "read", days: 1 }) });
  assert.equal(response.status, 201);
  const { token } = await response.json();
  const child = spawn(process.env.MCP_TEST_PYTHON || "python", ["scripts/check-python-mcp.py"], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  child.stdout.on("data", data => { output += data; });
  child.stderr.on("data", data => { errors += data; });
  child.stdin.end(JSON.stringify({ url: `${origin}/mcp`, token }) + "\n");
  const timeout = setTimeout(() => child.kill(), 30_000);
  try {
    const code = await new Promise((resolve, reject) => { child.on("exit", resolve); child.on("error", reject); });
    assert.equal(code, 0, errors.replaceAll(token, "[redacted]"));
    console.log(output.replaceAll(token, "[redacted]").trim());
  } finally { clearTimeout(timeout); }
} finally { await runtime.dispose(); }
