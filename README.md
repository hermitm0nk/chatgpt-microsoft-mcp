# Microsoft To Do MCP

A private ChatGPT Site and stateless MCP server for Microsoft To Do. The service is built as a Cloudflare Worker with D1 storage. Each signed-in Site owner connects their own Microsoft account; the deployment is an owner-only pilot, not a public multiuser service.

## Capabilities

The MCP server exposes eight bounded tools:

| Tool | Purpose | Permission |
| --- | --- | --- |
| `todo_connection_status` | Check whether the caller has a connected Microsoft account. | Read |
| `todo_list_lists` | List To Do lists, with cursor-based pagination. | Read |
| `todo_list_tasks` | List tasks in a specified list, with cursor-based pagination. | Read |
| `todo_get_task` | Read one task using its list and task IDs. | Read |
| `todo_create_task` | Create a task in a specified list. | Read/write |
| `todo_update_task` | Update supported fields on a specified task. | Read/write |
| `todo_complete_task` | Mark a specified task complete. | Read/write |
| `todo_delete_task` | Delete a specified task. | Read/write; destructive |

`todo_list_tasks` excludes completed tasks by default by asking Microsoft Graph to apply `status ne 'completed'`. Set `includeCompleted: true` to include them. Pagination cursors are encrypted and bound to the caller, list, Microsoft connection, and completed-task setting. Start a fresh list request if the setting changes.

Task titles and bodies are untrusted user content; tools treat them as data, never as instructions. List and task requests require explicit resource IDs, and tool schemas reject unknown fields.

## Security model

- The Site derives the account owner from its managed identity boundary. Callers cannot select another owner in tool arguments.
- Microsoft authorization and connection state are owner-scoped. Credentials are encrypted before storage; encryption material and the Microsoft client secret belong in the Site's runtime secret store, never in source, documentation, or chat.
- The Site is owner-only. Do not make it public or add visitors as part of ordinary deployment.
- Personal MCP tokens are optional, owner-scoped, expiring, and read-only by default. Issue a separate read/write token only when needed; the server checks permission before any write.
- Graph calls use `/me` routes, validate pagination destinations, and do not follow redirects. Error responses and telemetry avoid task content and credentials.

## Development and checks

Requires Node 22.13 or later.

```sh
npm ci
npm run db:migrate:local
npm run dev
```

Run the complete local validation suite with:

```sh
npm run check
```

This runs TypeScript checks, integration tests against local D1, a Worker build, and a bundled workerd smoke/regression test. Upstream Microsoft responses are mocked in integration tests; the smoke test uses synthetic identities and credentials. These checks do not validate another user's access or a browserless production connection.

## Deployment and operator docs

The existing owner-only Site is [Microsoft To Do MCP](https://todo-bridge.smart-rabbit.chatgpt.site/settings). The deployed application source is commit `4b7bf301074fe2a2e169bf0d19c8fb087078126e` (version 9). Preserve the Site's current access policy when publishing updates.

- [Operator setup](docs/operator-setup.md): Microsoft registration and runtime configuration.
- [Agent setup](docs/agent-setup.md): ChatGPT plugin and compatible MCP clients.
- [Implementation tracker](docs/implementation.md): deployment evidence, current status, and remaining pilot gates.
- [Product requirements](microsoft-todo-sites-mcp-prd.md): original product scope.

Do not commit `.env` files, API tokens, client secrets, encryption keys, OAuth codes, or real Microsoft token responses. `.env.example` contains variable names and placeholders only.
