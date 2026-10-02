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
| G1 Microsoft registration | User supplied client ID `aa3ff094-f57c-4818-88aa-b7e2e71efd38`; audience, permission, exact redirect and runtime credential still need verification. |
| G2 Sites callback | Private Site registered; no deployment or real browser round trip. OAuth defaults disabled. |
| G3 Trusted identity | Require Sites to strip caller-supplied identity headers and inject trusted identity; default trust disabled. Canonical scaffold helpers unavailable in this environment. |
| G4 External MCP reachability | Must verify access policy without shared bypass credentials. Preserve private audience until explicitly changed. |
| G5 Hermes | SDK transport will be tested locally; actual client/header configuration remains pending. |
| G6 Second ChatGPT account | Actual canonical plugin installation and owner consistency must be tested. |
| G7 Public distribution | Unverified; no launch/catalog claims. |
| G8 Runtime | Local Worker/D1 checks do not establish deployed refresh, quotas, or contention behavior. |

## Platform integration constraint

Installed Sites guidance provides resource text but its initializer and TypeScript scaffold files are not present in the executor or readable through the skill provider. The application is developed as a Worker-compatible fetch handler. Before publication, integrate this handler into the canonical Sites scaffold, retain the bundled `sites()` build plugin and browser auth helpers, reuse the private Site `appgprj_6abf8aadedf48191803c28c499c403bc`, and verify reserved dispatch routes. Do not register a replacement Site, replace Sites OAuth, or publish the development bundle directly through an alternative host.

The registered expected origin is `https://microsoft-todo-mcp.smart-rabbit.chatgpt.site`; it is not a verified live URL. Its exact Microsoft Web redirect URI is `https://microsoft-todo-mcp.smart-rabbit.chatgpt.site/api/microsoft/oauth-return`.

## Chosen provisional defaults

Personal Microsoft accounts only; 10-minute OAuth transactions; API tokens default read-only and expire after 90 days, maximum 365 days, with at most 20 active tokens. A Microsoft account replacement requires explicit confirmation and revokes all personal tokens. Disconnect also revokes tokens. Token metadata is cleaned up 30 days after expiry/revocation; rate records after one day. These are pilot defaults to review before release. Cleanup runs on Settings/authorization access and through the exported scheduled handler; no production schedule is configured yet.

Task writes support the PRD's title, body, status, importance, date and reminder fields. Plain text is escaped to HTML because the Graph update documentation specifies HTML-only task bodies. UTC and IANA input zones are supported; unambiguous IANA local dates are converted to UTC, while DST gaps/overlaps are rejected. Windows zone names are not accepted as input in this increment.

## Local evidence

`npm run check` runs strict TypeScript checks, 35 tests using real local D1 and signed JWTs, builds the Worker bundle, and executes the actual bundled MCP SDK/server in workerd. Coverage includes owner isolation, unknown owner arguments, read-only enforcement, OAuth replay/expiry/mismatched owner, explicit replacement, disconnect/callback races, refresh rotation/lease recovery, old-cache fencing, ciphertext tampering, CSRF, bounded bodies/pagination, safe errors, and ambiguous writes. Runtime smoke verifies health, eight-tool discovery, and fail-closed identity handling.

Upstream field/time-zone behavior was checked against Microsoft Graph's official repository documentation (`todotask-update.md`, `datetimetimezone.md`) on October 2, 2026. Actual Microsoft and client behavior remains a live gate.

No live gate is marked passed solely on local tests.
