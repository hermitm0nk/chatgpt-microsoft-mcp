# Operator setup

## Microsoft registration (manual)

1. Open Microsoft Entra App registrations in a directory you can administer. If you have no directory, confirm eligibility for the Azure free signup/default directory path.
2. Register a confidential web application supporting **personal Microsoft accounts only**. Use the `consumers` authority. Do not enable public-client flows.
3. Add Microsoft Graph **delegated** `Tasks.ReadWrite`. The app requests `openid profile offline_access Tasks.ReadWrite`; no `User.Read` is needed.
4. Record the application/client ID; it is safe to share. Create a client secret and put its **value**, not its ID, directly in the runtime secret store.
5. Register the exact **Web** redirect URI `https://microsoft-todo-mcp.smart-rabbit.chatgpt.site/api/microsoft/oauth-return`. This Site is registered but unpublished. Do not use Sites' reserved `/callback`.

## Runtime configuration (after Sites integration)

| Setting | Secret? | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | No | Exact HTTPS Site origin, no path/query. |
| `MICROSOFT_CLIENT_ID` | No | Application/client ID. |
| `MICROSOFT_CLIENT_SECRET` | Yes | Confidential web application credential. |
| `TOKEN_ENCRYPTION_KEYS` | Yes | JSON object mapping key IDs to base64url 32-byte AES keys. |
| `TOKEN_ENCRYPTION_KEY_ID` | No | Active key ID; keep old keys while old ciphertext exists. |
| `MICROSOFT_OAUTH_ENABLED` | No | `true` only after callback/platform review. |
| `TRUST_SITES_IDENTITY_HEADERS` | No | `true` only behind a verified Sites dispatcher that strips spoofed headers. |

The client ID provided is `aa3ff094-f57c-4818-88aa-b7e2e71efd38`. The exact `PUBLIC_BASE_URL` is `https://microsoft-todo-mcp.smart-rabbit.chatgpt.site`.

Generate key material directly into your secret manager using a CSPRNG. Do not paste keys into chat, source, hosting.json, or ordinary logs. `.dev.vars` is ignored for local-only secrets. Configure `DB` using Sites' D1 workflow and redeploy after secret changes.

## Network access for live tests

Full Internet access is unnecessary. Allow `login.microsoftonline.com` (authorization, token exchange, JWKS), `graph.microsoft.com` (To Do), and `microsoft-todo-mcp.smart-rabbit.chatgpt.site` (callback/MCP). Users perform interactive consent in their own browser; Microsoft may use additional login assets in that browser. Package-registry access suffices for automated local tests. GitHub access is needed to push progress. The environment currently has no Microsoft runtime secrets.

## Verification before enabling linking

Check Sites browser sign-in and reserved routes, anonymous spoofed headers, Microsoft callback session preservation, exact redirect URI, one-time state/PKCE/nonce checks, and two independent owners. Verify personal API-token requests can reach `/mcp` under the selected access policy without distributing a shared service credential. Verify Hermes custom-header support before documenting a tested configuration.

## No production launch yet

Retention periods, backup deletion, support contact, distribution eligibility, key rotation, and incident recovery need a release review. Microsoft disconnect deletes local credential material; it does not revoke Microsoft's global consent. Account replacement revokes personal tokens.
