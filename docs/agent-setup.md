# Agent setup and pilot verification

Microsoft browser sign-in succeeded for the owner on October 2, 2026. The Site remains owner-private. This guide distinguishes the managed ChatGPT path from personal-token clients.

## ChatGPT

Use the Site's existing **Microsoft To Do MCP** plugin under Plugins → Personal → Created by you. Install/connect or enable that plugin for the chat; do not create a duplicate developer-mode binding. The canonical plugin is `plugin_asdk_app_sites_a5d1c3483644819198f6cbcd37487114`.

Start with “Check my Microsoft To Do connection”, then “List my Microsoft To Do lists”. Expected connection state: `connected`, with the account label shown in Settings. Tool calls use Sites-managed identity and the caller's saved Microsoft connection. API tokens are unnecessary for this path. If installed tools are absent from an existing chat, enable the plugin or try a fresh chat with it enabled.

`todo_list_tasks` excludes completed tasks by default using a Microsoft Graph status filter. Pass `includeCompleted: true` when completed tasks are needed. The pagination cursor is tied to that choice; start a new list request before changing it.

In [Settings](https://todo-bridge.smart-rabbit.chatgpt.site/settings), **Check To Do access** invokes `todo_list_lists` through the same `/mcp` endpoint from the signed-in browser. It requests at most one list and changes no tasks. This proves browser MCP/Graph access; an independent managed ChatGPT tool call is still required to verify that client's identity mapping.

## Hermes: configuration supported by the inspected client

The upstream [Hermes source](https://github.com/NousResearch/hermes-agent/tree/2f80ae0a6a91932b1808a53f9c55f8b3f313d6cc) was inspected on October 2, 2026. It supports remote HTTP `url`, custom `headers`, `${VAR}` interpolation from the active profile's secret scope, `protocol: legacy`, and `strict_redirect_headers: true`. Its MCP extra pins `mcp==2.0.0` and `httpx2==2.7.0`.

**Live reachability gate:** the current owner-private Site has not been verified for a browserless personal-token request. Do not expect this example to bypass Sites sign-in or access policy. It is a prepared configuration, not a tested live Hermes installation. A public or otherwise supported route must be explicitly agreed and tested first. Never add a shared Sites service/bypass credential to this example.

After the reachability gate passes, create a **read-only** personal token in Settings and put it in the active Hermes profile's secret store as `MICROSOFT_TODO_API_TOKEN`. Keep the value out of chat and config YAML. Add this entry to the profile's `config.yaml`:

```yaml
mcp_servers:
  microsoft_todo:
    url: "https://todo-bridge.smart-rabbit.chatgpt.site/mcp"
    protocol: legacy
    strict_redirect_headers: true
    headers:
      X-MCP-API-Key: "${MICROSOFT_TODO_API_TOKEN}"
    tools:
      include:
        - todo_connection_status
        - todo_list_lists
        - todo_list_tasks
        - todo_get_task
      resources: false
      prompts: false
```

`legacy` selects the supported MCP handshake, negotiated as `2025-11-25`; it does not require a long-lived server session. Strict redirect handling protects the custom credential on cross-origin redirects. An unset secret reference fails closed in the inspected Hermes client. Tool filtering is a client convenience; the Site also enforces the token's read permission.

Run `hermes mcp test microsoft_todo` for initialization/discovery, then `/reload-mcp` in an active Hermes session. Ask Hermes to check the connection and list lists before asking for task data. Write tools require a separate read/write token and an intentional change to the allowlist.

## Reproducible Python transport check

This optional check exercises the Python SDK pinned by the inspected Hermes source against the actual bundled Worker on loopback. It creates a synthetic read-only token, initializes/discovers eight tools, and checks authenticated connection status and the actionable not-connected response. It uses no live Microsoft account, bypass credential, task data, or LLM key. It verifies SDK/header compatibility, not the complete Hermes CLI or deployed Sites boundary.

```sh
python -m venv /tmp/todo-mcp-test
/tmp/todo-mcp-test/bin/pip install mcp==2.0.0 httpx2==2.7.0
npm run build
MCP_TEST_PYTHON=/tmp/todo-mcp-test/bin/python node scripts/check-python-mcp.mjs
```

The normal `npm run check` separately tests synthetic signed OAuth and Graph requests in workerd, owner isolation in D1, token permissions, and refresh coordination.

## Remaining live pilot checks

1. A second permitted personal ChatGPT account links its own Microsoft account and cannot access the first user's data. The owner must explicitly choose the second viewer before access changes.
2. Personal-token requests reach the deployed `/mcp` endpoint without a browser or shared bypass credential; the chosen Site audience must permit this.
3. The user's installed Hermes version initializes, discovers and calls tools using its own personal token.
4. Access-token expiry triggers refresh and persists rotated credentials in production; revocation and disconnect stop access.

For task-write validation, use a clearly named disposable test task in an explicitly chosen list. Verify create → read → update → complete → delete and clean up only that task. Do not edit existing user tasks to run a general health check.
