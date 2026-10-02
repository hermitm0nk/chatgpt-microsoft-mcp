# Microsoft To Do MCP

Implementation of [the PRD](microsoft-todo-sites-mcp-prd.md), targeting ChatGPT Sites and Cloudflare Workers/D1. Each authenticated Site user owns one encrypted Microsoft connection; personal MCP tokens resolve to the same owner.

## Development

Requires Node 22.13+. Run `npm ci`, `npm run db:migrate:local`, then `npm run dev`. Run `npm run check` for type checks, D1/identity integration tests, a Worker bundle, and a workerd smoke check. GitHub Actions runs the same checks without secrets.

The development server deliberately ignores identity headers. Do not enable header trust on a directly reachable Worker. There is no developer-wide Microsoft connection or browser-stored credential.

## Delivery status

The private pilot is deployed at [todo-bridge.smart-rabbit.chatgpt.site](https://todo-bridge.smart-rabbit.chatgpt.site) as `appgprj_6abf8aadedf48191803c28c499c403bc`. Sites confirmed MCP support, provisioned its canonical plugin, applied all six D1 tables, and applied runtime configuration revision 1. Microsoft accepted the exact Web redirect `https://todo-bridge.smart-rabbit.chatgpt.site/api/ms/oauth-return`.

The missing bundled scaffold was resolved by using Sites' supported framework-independent Worker artifact. `npm run build` emits `dist/server/index.js` and its Worker configuration. `npm run sites:package` packages a clean committed source state. `scripts/sites-source.mjs` accepts short-lived Sites source credentials over hidden stdin and pushes without storing credentials or force-pushing.

Implemented: owner-scoped D1 storage; AES-GCM token encryption with versioned keys; state/PKCE/nonce-bound Microsoft linking; explicit account replacement; disconnect; fenced refresh leases; personal token issuance/expiry/revocation; Settings; and all eight proposed To Do MCP tools. Microsoft/Graph responses are mocked in integration tests; identity tests verify real JWT signatures against a local test JWKS.

Microsoft linking remains disabled pending the runtime client secret and a real consent round trip. Local configuration ignores managed identity headers; the hosted private Site enables header trust only behind Sites dispatch. Browser/managed MCP consistency, spoofing, external-client reachability, and two-user behavior still need live verification in [the implementation tracker](docs/implementation.md). Local tests do not prove the live boundary.

See [operator setup](docs/operator-setup.md) for manual registration and runtime configuration. Do not commit credentials or paste them into chat.
