# Implementation tracker

## Intended increments

1. Worker-compatible project, D1 schema, key handling, owner-scoped credentials.
2. Microsoft authorization transactions, validated identity, encrypted connection/refresh lifecycle.
3. Connection Settings and personal token management.
4. Stateless MCP and eight bounded To Do tools.
5. Security/integration checks and operational setup.

## Live verification gates (pending)

| Gate | Current evidence / blocker |
| --- | --- |
| G1 Microsoft registration | Operator must register a personal-account confidential web app. No secrets configured. |
| G2 Sites callback | No registered Site or real browser round trip. OAuth defaults disabled. |
| G3 Trusted identity | Require Sites to strip caller-supplied identity headers and inject trusted identity; default trust disabled. Canonical scaffold helpers unavailable in this environment. |
| G4 External MCP reachability | Must verify access policy without shared bypass credentials. Preserve private audience until explicitly changed. |
| G5 Hermes | SDK transport will be tested locally; actual client/header configuration remains pending. |
| G6 Second ChatGPT account | Actual canonical plugin installation and owner consistency must be tested. |
| G7 Public distribution | Unverified; no launch/catalog claims. |
| G8 Runtime | Local Worker/D1 checks do not establish deployed refresh, quotas, or contention behavior. |

## Platform integration constraint

Installed Sites guidance provides resource text but its initializer and TypeScript scaffold files are not present in the executor or readable through the skill provider. The application is developed as a Worker-compatible fetch handler. Before publication, integrate this handler into the canonical Sites scaffold, retain the bundled `sites()` build plugin and browser auth helpers, register one private Site, and verify reserved dispatch routes. Do not replace Sites OAuth or publish the development bundle directly through an alternative host.

## Chosen provisional defaults

Personal Microsoft accounts only; 10-minute OAuth transactions; API tokens default read-only and expire after 90 days, maximum 365 days. A Microsoft account replacement requires explicit confirmation and revokes all personal tokens. These defaults implement the PRD's proposals and can be refined before release.

No live gate is marked passed solely on local tests.
