# Build after L5 - Auth and security

Concepts required: [L5 Auth and security](../roadmap/05-auth-and-security.md).

---

### M02 — OAuth-Protected Remote Server

- **Size:** `[M]` one to two weeks
- **Unlocked after:** L5
- **Concepts:** OAuth 2.1, PRM (RFC 9728), AS discovery, PKCE, resource indicators
  (RFC 8707), audience validation, `iss` validation (RFC 9207), scope strategy, CIMD

**Goal.** A remote MCP server that a security reviewer would actually approve.

**Requirements**

1. Server acts as an OAuth 2.1 resource server and publishes Protected Resource Metadata at
   `/.well-known/oauth-protected-resource`, listing `authorization_servers` and a minimal
   `scopes_supported`.
2. Unauthenticated request -> `401` with `WWW-Authenticate: Bearer resource_metadata="...",
   scope="..."`.
3. Token validation: signature, expiry, issuer, **and audience** = your canonical server
   URI. Wrong audience -> `401`. No exceptions, no "we trust our gateway".
4. Scope enforcement per tool and per resource; privileged tools disappear from
   `tools/list` when the credential lacks scope (allowed: list may vary by authorization,
   never by connection).
5. Client side (extend S06): PRM discovery, AS metadata via RFC 8414 **and** OIDC discovery,
   PKCE, `resource` parameter on authorize **and** token requests, recorded issuer plus full
   four-case `iss` validation, refresh handling.
6. Client registration via Client ID Metadata Documents; DCR only as a documented fallback,
   noted as deprecated. Persisted client credentials keyed by issuer.
7. Step-up authorization: an operation needing an extra scope returns `401` with that scope,
   and the client re-authorizes including previously granted scopes.
8. Never log tokens. Never accept a token in a query string. `Authorization` header on
   every request.

**Acceptance**

- Full flow works end to end from a cold client, with frames and redirects captured.
- Test suite proves: wrong audience `401`; expired token `401`; missing scope hidden tool
  and `401`/error on direct call; `iss` mismatch aborts before code redemption; all four
  `iss` cases covered.
- A written scope table: scope -> tools/resources it unlocks -> why it is minimal.

**Stretch.** Add the [OAuth client credentials extension](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials)
for a machine caller with its own scopes and quota.

**Mastery marker.** Audience binding and `iss` validation are covered by tests, not by
comments.

---

### S10 — Server Smoke Suite

- **Size:** `[S]` two days (then grows forever)
- **Unlocked after:** L5
- **Concepts:** conformance thinking, protocol invariants, CI gating

**Goal.** A suite that points at **any** MCP server, by URL or command, and grades it
against 2026-07-28. This becomes your signature artifact.

**Requirements**

Implement at minimum these checks, each reporting pass/fail plus the spec rule:

1. `server/discover` implemented; `supportedVersions` non-empty; cache hints present.
2. Missing `io.modelcontextprotocol/protocolVersion` -> `-32602` (HTTP `400`).
3. Header/body version mismatch -> `-32020` + `400` (HTTP only).
4. Unsupported version -> `-32022` listing supported versions.
5. Unknown method -> `-32601` (HTTP `404`).
6. Every result carries `resultType`; `input_required` appears only on `tools/call`,
   `resources/read`, `prompts/get`.
7. Cache hints on all six cacheable operations; `ttlMs >= 0`; one `cacheScope` across pages.
8. `tools/list` byte-identical across two fresh connections with the same credential
   (invariance + deterministic ordering).
9. Tool names match the allowed charset and length; `inputSchema` is an object schema.
10. `structuredContent` validates against `outputSchema` where declared.
11. Progress only when `progressToken` was sent; log notifications only when `logLevel` was
    sent.
12. Cancellation: after stream close, no further messages for that id.
13. Security probes: wrong-audience token -> `401`; bad `Origin` -> `403`; no `x-mcp-header`
    on obviously sensitive parameter names.
14. Machine-readable report (JSON) plus a human summary, and a non-zero exit code on
    failure.

**Acceptance**

- Runs in CI against your own servers on every commit.
- Run it against at least two public servers; publish the findings and open issues for real
  violations.
- Adding a new check takes one small file, not a refactor.

**Stretch.** Add an era matrix: run the same checks against 2025-06-18 and 2025-11-25
servers, applying only the rules valid for that revision (see
[`reference/protocol-eras.md`](../reference/protocol-eras.md)).

**Mastery marker.** Each check cites the exact spec sentence it enforces.
