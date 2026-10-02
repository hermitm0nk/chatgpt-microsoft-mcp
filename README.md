# Microsoft To Do MCP

Implementation of [the PRD](microsoft-todo-sites-mcp-prd.md), targeting ChatGPT Sites and Cloudflare Workers/D1. Each authenticated Site user owns one encrypted Microsoft connection; personal MCP tokens resolve to the same owner.

## Development

Requires Node 22.13+. Run `npm ci`, `npm run db:migrate:local`, then `npm run dev`. Run `npm run check` for type checks, D1/identity integration tests, a Worker bundle, and a workerd smoke check. GitHub Actions runs the same checks without secrets.

The development server deliberately ignores identity headers. Do not enable header trust on a directly reachable Worker. There is no developer-wide Microsoft connection or browser-stored credential.

## Delivery status

The private Site is registered as `appgprj_6abf8aadedf48191803c28c499c403bc`, now with neutral slug `todo-bridge`. **It is not deployed.** Microsoft rejected the original redirect URI with a prohibited-word/restricted-domain error; a neutral URL is being evaluated, and the new origin must be verified before runtime configuration. The Worker build is not a deployable Sites artifact yet: the canonical Sites scaffold/build helper is unavailable in this environment.

Implemented: owner-scoped D1 storage; AES-GCM token encryption with versioned keys; state/PKCE/nonce-bound Microsoft linking; explicit account replacement; disconnect; fenced refresh leases; personal token issuance/expiry/revocation; Settings; and all eight proposed To Do MCP tools. Microsoft/Graph responses are mocked in integration tests; identity tests verify real JWT signatures against a local test JWKS.

Microsoft OAuth and Sites identity-header trust are disabled by default. Enable only after the platform gates in [the implementation tracker](docs/implementation.md) pass. Local tests provide controlled identities at the test boundary; they do not prove the live Sites boundary.

See [operator setup](docs/operator-setup.md) for manual registration and runtime configuration. Do not commit credentials or paste them into chat.
