# Microsoft To Do MCP

Implementation of [the PRD](microsoft-todo-sites-mcp-prd.md), targeting ChatGPT Sites and Cloudflare Workers/D1. Each authenticated Site user owns one encrypted Microsoft connection; personal MCP tokens resolve to the same owner.

## Development

Requires Node 22.13+. Run `npm ci`, `npm run db:migrate:local`, then `npm run dev`. Run `npm run check` for type checks, integration tests, and a Worker bundle.

The development server deliberately ignores identity headers. Do not enable header trust on a directly reachable Worker. There is no developer-wide Microsoft connection or browser-stored credential.

## Delivery status

Implementation is in progress. The Worker build is not a deployable Sites artifact yet: the canonical Sites scaffold/build helper is unavailable in this environment. `.openai/hosting.json` records required capabilities without claiming a registered Site.

Microsoft OAuth and Sites identity-header trust are disabled by default. Enable only after the platform gates in [the implementation tracker](docs/implementation.md) pass. Local tests provide controlled identities at the test boundary; they do not prove the live Sites boundary.

See [operator setup](docs/operator-setup.md) for manual registration and runtime configuration. Do not commit credentials or paste them into chat.
