# Cheatsheet - MCP 2026-07-28

Every rule you will forget, in one place. Each row is checkable against the linked spec
page. Keep this open while building.

---

## Message shapes

| Type | Must have | Must not have |
| --- | --- | --- |
| Request | `jsonrpc`, `id` (string/number, not `null`, not reused while outstanding), `method` | - |
| Result response | same `id`, `result.resultType` | both `result` and `error` |
| Error response | same `id` (unless unreadable), `error.code` (integer), `error.message` | - |
| Notification | `jsonrpc`, `method` | `id`, any response |

`resultType`: `"complete"` \| `"input_required"` \| extension value you advertised.
Absent (older servers) -> treat as `"complete"`. Unknown -> invalid.

## Required `_meta` on every client request

| Key | Required |
| --- | --- |
| `io.modelcontextprotocol/protocolVersion` | **Yes** |
| `io.modelcontextprotocol/clientCapabilities` | **Yes** |
| `io.modelcontextprotocol/clientInfo` | SHOULD |
| `io.modelcontextprotocol/logLevel` | optional (no field -> server MUST NOT send `notifications/message`) |
| `progressToken` | optional (no token -> no progress notifications) |
| `traceparent` / `tracestate` / `baggage` | optional, W3C format |

Results SHOULD include `_meta['io.modelcontextprotocol/serverInfo']`.
`subscriptions/listen` notifications MUST include `io.modelcontextprotocol/subscriptionId`.

**`_meta` key naming:** optional reverse-DNS prefix + `/` + name. Reserved if the second
label is `modelcontextprotocol` or `mcp` (`io.modelcontextprotocol/`, `dev.mcp/`,
`com.mcp.tools/`). `com.example.mcp/` is yours. `traceparent`/`tracestate`/`baggage` are
prefix-exempt.

## Error codes

| Code | Name | Trigger |
| --- | --- | --- |
| `-32700` | Parse error | broken JSON |
| `-32600` | Invalid request | not JSON-RPC shaped |
| `-32601` | Method not found | unknown method (HTTP `404`) |
| `-32602` | Invalid params | missing required `_meta`, bad args, **resource not found** |
| `-32603` | Internal error | unhandled failure |
| `-32020` | `HeaderMismatch` | `MCP-Protocol-Version` header != `_meta` value (HTTP `400`) |
| `-32021` | `MissingRequiredClientCapability` | needs a capability the client did not declare (HTTP `400`) |
| `-32022` | `UnsupportedProtocolVersion` | version not implemented (HTTP `400`) |

Ranges: `-32000..-32019` legacy (do not allocate, assume no meaning);
`-32020..-32099` reserved for the spec; new app errors outside `-32768..-32000`.
Retired: `-32002` (old resource-not-found; still *accept* from old servers), `-32042`.

## Methods

| Method | Notes |
| --- | --- |
| `server/discover` | servers **MUST** implement; returns `supportedVersions`, `capabilities`, `instructions`, cache hints |
| `tools/list` / `tools/call` | list is paginated + cacheable, deterministic order, invariant per connection |
| `resources/list` / `resources/templates/list` / `resources/read` | paginated (lists) + cacheable |
| `prompts/list` / `prompts/get` | paginated + cacheable |
| `completion/complete` | argument autocomplete for prompts and templates |
| `subscriptions/listen` | one long-lived POST stream for opted-in change notifications |
| `notifications/progress` | request-scoped, needs `progressToken` |
| `notifications/message` | request-scoped, needs `logLevel` |
| `notifications/cancelled` | **stdio only** |
| `notifications/tools/list_changed`, `.../prompts/list_changed`, `.../resources/list_changed`, `.../resources/updated` | delivered on the listen stream |

Gone in this revision: `initialize`, `notifications/initialized`, `ping`,
`logging/setLevel`, `notifications/roots/list_changed`, `resources/subscribe`,
`resources/unsubscribe`, GET SSE endpoint, `Mcp-Session-Id`, `Last-Event-ID` resumability,
server-initiated requests, `tasks/*` in core (now an extension).

## MRTR (multi round-trip requests)

- Allowed only on `tools/call`, `resources/read`, `prompts/get`.
- Result: `resultType: "input_required"`, with `inputRequests` (map of `ElicitRequest` /
  `CreateMessageRequest` / `ListRootsRequest`) and/or `requestState`. At least one required.
- Client retries the **original** request with `inputResponses` + the exact `requestState`
  and a **new JSON-RPC id**.
- Server MUST NOT ask for a capability the client did not declare.
- `requestState` is attacker-controlled: HMAC/AEAD it; bind principal, TTL and a digest of
  method + salient params; enforce single-use yourself if needed.
- MRTR results and `input_required` results are **never cacheable**.

## Caching

Required on `resultType: "complete"` for: `server/discover`, `tools/list`, `prompts/list`,
`resources/list`, `resources/templates/list`, `resources/read`.

| Field | Rule |
| --- | --- |
| `ttlMs` | integer >= 0; `0` = immediately stale; absent -> treat as `0`; negative -> treat as `0`; not a polling interval |
| `cacheScope` | `"public"` (shareable by any caller/proxy) or `"private"` (same authorization context only) |

Cache key = method + result-affecting params. Per-page TTLs allowed; `cacheScope` must be
identical across all pages of one list. `listChanged` notifications invalidate immediately.
`cacheScope` is **not** access control.

## Transports

### stdio
Newline-delimited JSON on stdout, no embedded newlines, logs on **stderr**, no session
semantics, `notifications/cancelled` for cancel, `server/discover` as the legacy-fallback
probe, credentials from the environment.

### Streamable HTTP
Single POST endpoint. `Accept: application/json, text/event-stream`. One message per POST.
Notification -> `202`. Request -> JSON object or request-scoped SSE stream. No independent
server requests on the stream. Final response closes it. No resumability - re-issue with a
new id. `X-Accel-Buffering: no`; SSE comment lines as keep-alive. Validate `Origin` (`403`
if invalid); bind localhost when local.

| Header | Required |
| --- | --- |
| `MCP-Protocol-Version` | every POST, must equal `_meta` value |
| `Mcp-Method` | every request |
| `Mcp-Name` | `tools/call`, `resources/read`, `prompts/get` |
| `Mcp-Param-{Name}` | when a tool parameter carries `x-mcp-header` |
| `Authorization: Bearer` | every request when protected |

## Tools

- Names: 1-128 chars, `A-Za-z0-9_-.`, case-sensitive, unique per server; aggregators must
  namespace; `serverInfo.name` is not unique.
- `inputSchema` MUST be an object schema; no params -> `{"type":"object","additionalProperties":false}`.
- `outputSchema` optional; if present, `structuredContent` MUST conform, and mirror JSON in
  a text block for old clients.
- Business failure -> result with `isError: true`. Invalid request -> JSON-RPC error.
- `annotations` are untrusted. Deterministic ordering SHOULD be maintained.
- `x-mcp-header`: primitive types only (`string`, `integer`, `boolean`; **not** `number`),
  HTTP token syntax, no CR/LF, case-insensitively unique, statically reachable. Clients MUST
  drop violating tools. Never for secrets/PII.

## Resources

- Capability flags `listChanged`, `subscribe` (independent).
- `resources/read` -> `contents[]` with `text` or `blob`; multiple contents allowed.
- Templates are RFC 6570; arguments completable.
- Annotations: `audience`, `priority`, `lastModified`.
- Not found -> `-32602`.

## JSON Schema

Default dialect 2020-12; support it at minimum; handle unsupported dialects with an error.
Never auto-dereference network `$ref` (opt-in only, allowlisted, no loopback/private
ranges). Bound depth/subschema count/time (DoS). Reject schemas with unresolved external
`$ref` rather than treating them as permissive.

## Authorization (HTTP only)

| Rule | Level |
| --- | --- |
| Server implements Protected Resource Metadata (RFC 9728) | MUST |
| Client discovers AS via PRM | MUST |
| AS metadata via RFC 8414 or OIDC Discovery; client supports both | MUST |
| `resource` parameter (RFC 8707) on authorize **and** token requests, canonical URI | MUST |
| Server validates token audience = itself | MUST |
| Bearer token in header on every request, never in query | MUST |
| Invalid/expired -> `401` with `WWW-Authenticate` (`resource_metadata`, `scope`) | MUST |
| Client validates `iss` (RFC 9207) before redeeming code, no normalisation | MUST when present |
| CIMD for client registration | SHOULD (DCR deprecated) |
| Credentials keyed by issuer, re-register on AS change | MUST |
| stdio uses environment credentials, not this flow | SHOULD NOT use OAuth |

## Deprecated (12-month minimum window)

Roots, Sampling, Logging, HTTP+SSE transport, Dynamic Client Registration,
`includeContext: "thisServer"` / `"allServers"`.
Registry: https://modelcontextprotocol.io/specification/2026-07-28/deprecated

## Spec links

- Base protocol: https://modelcontextprotocol.io/specification/2026-07-28/basic/index
- Versioning: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
- MRTR: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
- Subscriptions: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions
- Progress: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress
- Cancellation: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation
- stdio: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio
- Streamable HTTP: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
- Authorization: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization/index
- Discovery: https://modelcontextprotocol.io/specification/2026-07-28/server/discover
- Tools: https://modelcontextprotocol.io/specification/2026-07-28/server/tools
- Resources: https://modelcontextprotocol.io/specification/2026-07-28/server/resources
- Prompts: https://modelcontextprotocol.io/specification/2026-07-28/server/prompts
- Caching: https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching
- Pagination: https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination
- Completion: https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/completion
- Schema reference: https://modelcontextprotocol.io/specification/2026-07-28/schema
- Changelog: https://modelcontextprotocol.io/specification/2026-07-28/changelog
