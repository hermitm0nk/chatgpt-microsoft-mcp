# Implementation tracker

## Implemented increments

1. Worker-compatible project, D1 schema, key handling, owner-scoped credentials.
2. Microsoft authorization transactions, validated identity, encrypted connection/refresh lifecycle.
3. Connection Settings and personal token management.
4. Stateless MCP and eight bounded To Do tools.
5. Security/integration checks and operational setup.

## Live verification gates (pending)

| Gate | Current evidence / blocker |
| --- | --- |
| G1 Microsoft registration | User supplied client ID `aa3ff094-f57c-4818-88aa-b7e2e71efd38` and confirmed Microsoft accepted the neutral exact Web redirect. Audience, permission and runtime credential still need verification. |
| G2 Sites callback | Private Worker deployed at the accepted origin. Real Microsoft browser round trip awaits client secret; linking remains disabled. |
| G3 Trusted identity | Private runtime consumes documented Sites dispatch headers. Local trust stays disabled. Spoofed-header tests, browser identity and managed MCP owner consistency remain live checks. |
| G4 External MCP reachability | Must verify access policy without shared bypass credentials. Preserve private audience until explicitly changed. |
| G5 Hermes | SDK transport will be tested locally; actual client/header configuration remains pending. |
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

`PUBLIC_BASE_URL`, the user-provided Microsoft client ID, and active encryption key version `v1` are configured. AES key material was generated directly into `TOKEN_ENCRYPTION_KEYS` in Sites runtime secrets; it is absent from source and ordinary output. `TRUST_SITES_IDENTITY_HEADERS=true` applies only to the hosted private Site behind dispatch. `MICROSOFT_OAUTH_ENABLED=false` until the client secret is configured and the operator can perform the controlled consent test. No Microsoft credentials or customer connection have been stored by deployment.

## Chosen provisional defaults

Personal Microsoft accounts only; 10-minute OAuth transactions; API tokens default read-only and expire after 90 days, maximum 365 days, with at most 20 active tokens. A Microsoft account replacement requires explicit confirmation and revokes all personal tokens. Disconnect also revokes tokens. Token metadata is cleaned up 30 days after expiry/revocation; rate records after one day. These are pilot defaults to review before release. Cleanup runs on Settings/authorization access and through the exported scheduled handler; no production schedule is configured yet.

Task writes support the PRD's title, body, status, importance, date and reminder fields. Plain text is escaped to HTML because the Graph update documentation specifies HTML-only task bodies. UTC and IANA input zones are supported; unambiguous IANA local dates are converted to UTC, while DST gaps/overlaps are rejected. Windows zone names are not accepted as input in this increment.

## Local evidence

`npm run check` runs strict TypeScript checks, 35 tests using real local D1 and signed JWTs, builds the Worker bundle, and executes the actual bundled MCP SDK/server in workerd. Coverage includes owner isolation, unknown owner arguments, read-only enforcement, OAuth replay/expiry/mismatched owner, explicit replacement, disconnect/callback races, refresh rotation/lease recovery, old-cache fencing, ciphertext tampering, CSRF, bounded bodies/pagination, safe errors, and ambiguous writes. Runtime smoke verifies health, eight-tool discovery, and fail-closed identity handling.

Upstream field/time-zone behavior was checked against Microsoft Graph's official repository documentation (`todotask-update.md`, `datetimetimezone.md`) on October 2, 2026. Actual Microsoft and client behavior remains a live gate.

No live gate is marked passed solely on local tests.
