# Protocol eras and migration

MCP has shipped five revisions. Most tutorials, blog posts and Stack Overflow answers you
will find describe the **pre-2026** world. Knowing which era a piece of code is from is a
daily survival skill.

| Revision | Headline |
| --- | --- |
| `2024-11-05` | First public revision. stdio + HTTP+SSE transport (two endpoints). `initialize` handshake. |
| `2025-03-26` | **Streamable HTTP** introduced, replacing HTTP+SSE. Sessions via `Mcp-Session-Id`. |
| `2025-06-18` | JSON-RPC **batching removed**. `MCP-Protocol-Version` header introduced. Elicitation added. Structured tool output. |
| `2025-11-25` | Tasks (experimental, in core). URL-mode elicitation with `elicitationId`. |
| `2026-07-28` | **Breaking:** stateless core, no handshake, no sessions, `server/discover`, MRTR, `subscriptions/listen`, required cache hints, Tasks moved to an extension. |

Sources: each revision's changelog under
`https://modelcontextprotocol.io/specification/<revision>/changelog`, plus the
[2026-07-28 key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog).

---

## What changed in 2026-07-28, in migration terms

| Old (2025-03-26 .. 2025-11-25) | New (2026-07-28) | Migration action |
| --- | --- | --- |
| `initialize` + `notifications/initialized` | per-request `_meta`, plus `server/discover` | Move capability/version logic into per-request handling; implement `server/discover` |
| `Mcp-Session-Id` header, session state | nothing | Replace session state with server-minted handles passed as tool arguments |
| Server-initiated `sampling/createMessage`, `elicitation/create`, `roots/list` | `InputRequiredResult` + retry (MRTR) | Rewrite those code paths; add `requestState` signing |
| GET SSE endpoint, `resources/subscribe` | `subscriptions/listen` | One long-lived POST stream with opt-in notification types |
| `Last-Event-ID` resumability | none | Client re-issues with a new id after stream loss |
| `ping` | none | Rely on transport keep-alives / SSE comments |
| `logging/setLevel` | `_meta['io.modelcontextprotocol/logLevel']` per request | Emit logs only for requests that asked |
| Optional/no cache metadata | required `ttlMs` + `cacheScope` on six operations | Add hints; decide public vs private per operation |
| Results without `resultType` | `resultType` required | Add to every result; clients treat absent as `complete` |
| Resource not found `-32002` | `-32602` | Change emission; still accept `-32002` as a client |
| Tasks in core (`tasks/result` blocking, `tasks/list`) | `io.modelcontextprotocol/tasks` extension (`tasks/get` polling, `tasks/update`) | Negotiate via `extensions`; drop `tasks/list` |
| Roots / Sampling / Logging features | deprecated | Pass paths as arguments; call the LLM API directly; use stderr/OTel |
| `includeContext: "thisServer"` / `"allServers"` on sampling | deprecated | Omit the field or use `"none"`; removal follows Sampling |
| Dynamic Client Registration | deprecated | Move to Client ID Metadata Documents |
| HTTP+SSE transport | deprecated | Streamable HTTP |
| `notifications/elicitation/complete`, `elicitationId` | removed | Learn outcome by retrying; correlate inside `requestState` |

---

## Supporting two eras in one codebase

Decide deliberately, then write it in your README: "this server speaks 2026-07-28 and
2025-06-18". Support costs tests.

### Server side

1. Advertise honestly: `supportedVersions` in `server/discover` must match what you test.
2. Keep an **era adapter** at the edge. Business logic sees one internal request type.
3. On HTTP, branch on `MCP-Protocol-Version`; a missing header **MAY** be treated as
   `2025-03-26` if you choose to support that era, otherwise reject.
4. On stdio, answer `server/discover` for modern clients and keep an `initialize` handler
   for legacy ones.
5. Emit era-correct errors: a 2026-07-28 implementation **MUST NOT** emit `-32002`
   (resource not found, replaced by `-32602`) or `-32042` (URL elicitation required,
   2025-11-25 only); legacy paths must not emit `-32020..-32022` to clients that predate
   them.
6. Emit cache hints always - harmless to older clients that ignore them.
7. Never send server-initiated requests to a modern client, and never send MRTR results to
   a legacy client.

### Client side

1. Prefer `server/discover`; fall back to `initialize` on failure (stdio) or on a
   version error (HTTP).
2. Treat absent `resultType` as `"complete"`.
3. Accept `-32002` as resource-not-found from older servers.
4. Handle both server-initiated requests (legacy) and MRTR (modern) behind one internal
   interface.
5. Handle both `Mcp-Session-Id` (legacy) and no session (modern) in the transport layer
   only.

### Test matrix

| Case | 2026-07-28 | 2025-11-25 / 2025-06-18 |
| --- | --- | --- |
| Discovery | `server/discover` returns versions + hints | `initialize` handshake succeeds |
| Version mismatch | `-32022` with list | protocol-version header error path |
| Result typing | `resultType` present | absent, treated as complete |
| Server needs input | MRTR retry | server-initiated request |
| Change notifications | `subscriptions/listen` | GET stream / `resources/subscribe` |
| Cancellation | stream close (HTTP) / `notifications/cancelled` (stdio) | same message paths as that era |
| Resource missing | `-32602` | `-32002` accepted |

Run it in CI per era you claim. A README claim without a test row is marketing.

---

## Reading old material safely

Red flags that a tutorial is pre-2026 and needs mental translation:

- calls `initialize` or mentions `notifications/initialized`
- mentions `Mcp-Session-Id`, session resumption, or `Last-Event-ID`
- opens a GET SSE stream
- has the server sending `sampling/createMessage` or `elicitation/create` as a request
- uses `resources/subscribe`
- shows results without `resultType`
- shows no `ttlMs`/`cacheScope` on list results
- treats Tasks as core
- recommends Dynamic Client Registration

None of it is useless - it is just a different era. Translate, do not copy.
