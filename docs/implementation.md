# Implementation tracker

## Implemented increments

1. Worker-compatible project, D1 schema, key handling, owner-scoped credentials.
2. Microsoft authorization transactions, validated identity, encrypted connection/refresh lifecycle.
3. Connection Settings and personal token management.
4. Stateless MCP and eight bounded To Do tools.
5. Security/integration checks and operational setup.
6. Settings access check through the existing MCP endpoint, sanitized upstream measurements, and Python MCP client interoperability.

## Live verification gates (pending)

| Gate | Current evidence / blocker |
| --- | --- |
| G1 Microsoft registration | Passed for the owner's personal-account pilot: registered client/secret/Web redirect completed the token exchange and granted checked Tasks.ReadWrite and offline access. Additional users remain unverified. |
| G2 Sites callback | Passed for the owner: user confirmed connected Settings/account label on October 2, 2026; callback at 11:53:30 UTC returned 303 with no failure event. Cancellation/reconnect/second-owner checks remain. |
| G3 Trusted identity | Private runtime consumes documented Sites dispatch headers. Local trust stays disabled. Spoofed-header tests, browser identity and managed MCP owner consistency remain live checks. |
| G4 External MCP reachability | Must verify access policy without shared bypass credentials. Preserve private audience until explicitly changed. |
| G5 Hermes | Inspected upstream commit `2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc`: HTTP/custom headers/profile-secret interpolation supported. Its pinned Python MCP 2.0.0 SDK passes local Worker handshake/discovery/token reads. Actual installed Hermes and private Site reachability remain live gates. |
| G6 Second ChatGPT account | Actual canonical plugin installation and owner consistency must be tested. |
| G7 Public distribution | Unverified; no launch/catalog claims. |
| G8 Runtime | Actual bundled Worker deployed successfully; all six D1 tables applied and MCP capability confirmed. Deployed token refresh, quotas and contention still need live verification. |

## Platform integration and deployment

The bundled Sites initializer/build helper is unavailable in this executor, but Sites accepts a standard Worker artifact without a framework scaffold. `scripts/build.mjs` emits `dist/server/index.js` and `wrangler.json`; the deployment archive includes `.openai/hosting.json` and immutable Drizzle migrations. `scripts/sites-source.mjs` uses short-lived credentials via hidden stdin/child environment, never persisting them. It pushes the exact committed source without force; `scripts/package-sites.mjs` binds packaging to a clean commit. Reserved ChatGPT routes remain owned by Sites dispatch; no app-owned identity provider or duplicate plugin was introduced.

First private publication succeeded on October 2, 2026 at `https://todo-bridge.smart-rabbit.chatgpt.site`, from source commit `ad1026b1c29de641cfa2c4042c2d3d4b199081f6`, deployment `appgdep_6abf8ee8eed88191b15c0ece68449745`. Sites confirmed `has_mcp: true`, runtime revision 1, and all six user tables. The canonical plugin is `plugin_asdk_app_sites_a5d1c3483644819198f6cbcd37487114`. The audience remains owner-private; external visitors were not added. Reuse this Site and canonical plugin for future updates.

Microsoft rejected the initial `https://microsoft-todo-mcp.smart-rabbit.chatgpt.site/api/microsoft/oauth-return` registration with “Your reply url contains prohibited words or restricted domains” (operator screenshot, October 2, 2026). This establishes rejection of that full URI, not which component was blocked. Microsoft's published redirect-URI restrictions do not identify the offending component or publish the applicable restricted-domain list.

The same private Site was renamed to neutral slug `todo-bridge`, and the application callback path is now `/api/ms/oauth-return`. The operator confirmed Microsoft accepted `https://todo-bridge.smart-rabbit.chatgpt.site/api/ms/oauth-return` on October 2, 2026. Deployment confirmed that exact origin. This resolves registration of that URI; the exact offending part of the original URL is still unknown. Test a real authorization round trip with the operator before enabling linking for broader users.

No custom domain, redirect relay, account-audience change, hosting switch or device-code fallback is needed for the accepted URI.

## Current runtime setup

`PUBLIC_BASE_URL`, the user-provided Microsoft client ID, and active encryption key version `v1` are configured. AES key material was generated directly into `TOKEN_ENCRYPTION_KEYS` in Sites runtime secrets; it is absent from source and ordinary output. `TRUST_SITES_IDENTITY_HEADERS=true` applies only to the hosted private Site behind dispatch. The operator configured `MICROSOFT_CLIENT_SECRET` in Sites; runtime revision 3 enables `MICROSOFT_OAUTH_ENABLED=true`. The operator's live sign-in succeeded on October 2, 2026, confirming token exchange, signed identity validation, permission checks and encrypted connection persistence for that owner. No raw credential or database token cache was read for this verification.

Production logs on October 2 at 11:32:56 UTC show `/api/ms/oauth-return` redirecting to Settings after `microsoft_unavailable` (reference `119d49a3-3b88-4716-ad99-3431281e14f6`). State consumption succeeded before the token exchange failed. The old error grouped fetch, response parsing, provider rejection and schema validation, so its exact cause is unknown. Source `5291ec4f6e784c48d9cf1bb4eda08f8ddf7696f6` adds bounded diagnostics containing only fixed stages, HTTP status, allowlisted provider error categories and schema field names, plus a Settings reference. OAuth token types now accept case-insensitive Bearer spelling per RFC 6749 section 7.1; live confirmation is pending. Restart Connect for each attempt because callback transactions are single-use. Never log response bodies, tokens, codes or provider error descriptions.

The 11:44:56 UTC retry (reference `9824d197-63f3-49fc-935b-f1543b2b1770`) reports `token_fetch/network`. A minimal workerd reproduction throws `TypeError` for `redirect: "error"`: the runtime only supports `follow` and `manual`. This invalid option affected token exchange, signing-key fetches and Graph calls. All three now use `manual` and explicitly reject 3xx without following or forwarding credentials. `scripts/smoke-microsoft.mjs` exercises the bundled Worker using synthetic upstreams: owner-bound OAuth, token exchange, signed JWKS validation, Graph reads, and rejection of token/key/Graph redirects including uncertain writes. It uses no real Microsoft credentials or task data. Node-level fetch mocks alone did not catch this runtime incompatibility.

The same regression exposed a second workerd-specific incompatibility: `this.fetcher(...)` invokes global fetch with the Graph instance as its receiver, producing `Illegal invocation`. The Graph client now invokes a local function reference. Synthetic signed OAuth completion and subsequent MCP Graph reads pass in the actual bundled Worker; live consent remains the next verification gate.

## Chosen provisional defaults

Personal Microsoft accounts only; 10-minute OAuth transactions; API tokens default read-only and expire after 90 days, maximum 365 days, with at most 20 active tokens. A Microsoft account replacement requires explicit confirmation and revokes all personal tokens. Disconnect also revokes tokens. Token metadata is cleaned up 30 days after expiry/revocation; rate records after one day. These are pilot defaults to review before release. Cleanup runs on Settings/authorization access and through the exported scheduled handler; no production schedule is configured yet.

Task writes support the PRD's title, body, status, importance, date and reminder fields. Plain text is escaped to HTML because the Graph update documentation specifies HTML-only task bodies. UTC and IANA input zones are supported; unambiguous IANA local dates are converted to UTC, while DST gaps/overlaps are rejected. Windows zone names are not accepted as input in this increment.

## Local evidence

`npm run check` runs strict TypeScript checks, 37 tests using real local D1 and signed JWTs, builds the Worker bundle, and executes the actual bundled MCP SDK/server in workerd. Coverage includes owner isolation, unknown owner arguments, read-only enforcement, OAuth replay/expiry/mismatched owner, explicit replacement, disconnect/callback races, refresh rotation/lease recovery, old-cache fencing, ciphertext tampering, CSRF, bounded bodies/pagination, safe errors, token response casing/diagnostic redaction, and ambiguous writes. Runtime smoke verifies health, eight-tool discovery, and fail-closed identity handling.

Upstream field/time-zone behavior was checked against Microsoft Graph's official repository documentation (`todotask-update.md`, `datetimetimezone.md`) on October 2, 2026. Actual Microsoft and client behavior remains a live gate.

`scripts/check-python-mcp.mjs` and `.py` provide an optional reproducible test of the Python SDK pinned by the inspected Hermes source. The actual loopback Worker issues a synthetic read-only personal token, and the client initializes at `2025-11-25`, discovers eight tools, checks permission and receives actionable not-connected results. This passes with `mcp==2.0.0`/`httpx2==2.7.0`; it does not establish the full Hermes CLI or production reachability. See `docs/agent-setup.md` for the prepared profile configuration and its explicit live gates.

Settings' **Check To Do access** makes a bounded, read-only `todo_list_lists` call through `/mcp` from the signed-in browser. It does not persist or display list contents. A successful click verifies that browser caller's Graph read path; it does not substitute for the canonical plugin caller check. Sites reports the canonical plugin already installed, but its tools are not exposed in this chat. The owner was asked to enable/connect it and try connection status.

The Worker emits low-cardinality measurements for token exchange grant/outcome/duration, Graph method/status/duration (status 0 for network errors), and successful/cancelled/replacement authorization outcomes. Sites supplies invocation/request context and request timing. Measurements exclude owners, account labels, URLs, headers, provider descriptions, credentials and task content; token-response tests check redaction. No analytics database or task mirror was introduced. Platform log retention still needs a release review.

No live gate is marked passed solely on local tests.
