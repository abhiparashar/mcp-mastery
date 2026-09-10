# L1 - Protocol Core (the stateless model)

**Time:** 1 week. **Goal:** be the person in the room who knows exactly what is on the
wire and why.

This is the highest-leverage level in the roadmap. The 2026-07-28 revision rewrote the
core: no handshake, no sessions, per-request metadata, typed results. Everyone who learned
MCP in 2025 now has a wrong mental model. Getting this right is most of the gap.

---

## 1. MCP is stateless

> "The Model Context Protocol is a stateless protocol: all the information needed to
> process a request is contained in the request itself."
> - [Base protocol: Statelessness](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#statelessness)

What that means concretely:

- Servers **MUST NOT** rely on earlier requests on the same connection to learn
  capabilities, protocol version, or client identity. Every request re-supplies them in `_meta`.
- Servers **SHOULD NOT** require a client to reuse the same connection or process for
  related work.
- A stdio process is **not** a session. Clients may interleave unrelated requests on it.
- State that must span requests (long jobs, cursors, wizard progress) **MUST** be carried
  by an explicit identifier the client passes back - a **server-minted handle** or the
  opaque `requestState` from MRTR.

What went away in this revision (all previously core):

| Removed | Replacement |
| --- | --- |
| `initialize` + `notifications/initialized` handshake | Per-request `_meta`, plus `server/discover` |
| `Mcp-Session-Id` header | Nothing. Use explicit handles in tool arguments |
| `ping` | Transport-level keep-alive (SSE comment lines) |
| `logging/setLevel` | Per-request `io.modelcontextprotocol/logLevel` in `_meta` |
| `notifications/roots/list_changed` | Gone; Roots itself is deprecated |
| GET SSE endpoint, `resources/subscribe` | One `subscriptions/listen` request |
| Server-initiated requests (sampling/elicitation/roots) | MRTR `InputRequiredResult` |
| `Last-Event-ID` resumability | Re-issue the request with a new id |

Source: [Key changes](https://modelcontextprotocol.io/specification/2026-07-28/changelog).

**Why they did it.** Sessions forced sticky routing and shared state between server
replicas. Removing them makes an MCP server a normal stateless HTTP service: any replica
can answer any request, scale-out is trivial, and lists become cacheable by
intermediaries. Say that sentence in an interview and you sound like someone who reads
design rationale, not tutorials.

---

## 2. `_meta`: the per-request envelope

Every client request carries protocol metadata inside `params._meta`.

| Key | Type | Required | Purpose |
| --- | --- | --- | --- |
| `io.modelcontextprotocol/protocolVersion` | string | **Yes** | e.g. `"2026-07-28"` |
| `io.modelcontextprotocol/clientCapabilities` | object | **Yes** | what the client can do for this request |
| `io.modelcontextprotocol/clientInfo` | object | SHOULD | name + version, display/logs only |
| `io.modelcontextprotocol/logLevel` | string | No | minimum log level to emit for this request |
| `progressToken` | string/number | No | opts the request into progress notifications |
| `traceparent`, `tracestate`, `baggage` | string | No | W3C trace context (OpenTelemetry) |

Results carry `_meta['io.modelcontextprotocol/serverInfo']` (SHOULD). Notifications on a
`subscriptions/listen` stream **MUST** carry `io.modelcontextprotocol/subscriptionId`.

Hard rules worth memorising:

- Missing a required `_meta` field is **malformed**: reject with `-32602`, and on HTTP
  return `400 Bad Request`.
- A server **MUST NOT** rely on a capability the client did not declare. If it needs one,
  return `MissingRequiredClientCapability` (`-32021`) with `data.requiredCapabilities`,
  and HTTP `400`.
- Key naming: optional reverse-DNS prefix then a name. Any prefix whose second label is
  `modelcontextprotocol` or `mcp` is **reserved** (`io.modelcontextprotocol/`, `dev.mcp/`,
  `com.mcp.tools/`). `com.example.mcp/` is *not* reserved, because the second label is
  `example`. Use your own vendor prefix for your own keys.
- `traceparent`/`tracestate`/`baggage` are the one exception to the prefix rule, kept for
  OpenTelemetry compatibility.

Source: [`_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta).

Example, fully formed:

```json
{
  "jsonrpc": "2.0",
  "id": 7,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "Bengaluru" },
    "_meta": {
      "io.modelcontextprotocol/protocolVersion": "2026-07-28",
      "io.modelcontextprotocol/clientCapabilities": { "elicitation": {} },
      "io.modelcontextprotocol/clientInfo": { "name": "my-host", "version": "0.3.1" },
      "io.modelcontextprotocol/logLevel": "warning",
      "progressToken": "wx-7",
      "traceparent": "00-0af7651916cd43dd8448eb211c80319c-00f067aa0ba902b7-01"
    }
  }
}
```

---

## 3. `server/discover`

Servers **MUST** implement `server/discover`. Clients **MAY** call it. It returns, in one
round trip: supported protocol versions, capabilities, identity, optional `instructions`
for the model, and cache hints.

```json
{
  "jsonrpc": "2.0",
  "id": "discover-1",
  "result": {
    "resultType": "complete",
    "supportedVersions": ["2026-07-28", "2025-11-25"],
    "capabilities": { "tools": { "listChanged": true }, "resources": {} },
    "_meta": { "io.modelcontextprotocol/serverInfo": { "name": "ExampleServer", "version": "1.0.0" } },
    "instructions": "Use search_orders before refund_order.",
    "ttlMs": 3600000,
    "cacheScope": "public"
  }
}
```

Two legitimate uses:

1. **Show me what you are.** One call instead of probing `tools/list` + `prompts/list` +
   `resources/list`.
2. **stdio backwards-compatibility probe.** On stdio there is no HTTP status code to drive
   fallback, so a client that supports both modern and legacy (`initialize`) servers
   **SHOULD** send `server/discover` first and fall back if it fails.

`instructions` is a real prompt-engineering surface: it is natural-language guidance for
the model about how to use this server. Most servers waste it.

Source: [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover).

---

## 4. `resultType`: results are polymorphic now

Every result **MUST** include `resultType`:

| Value | Meaning |
| --- | --- |
| `"complete"` | Final answer, parse the rest of the result normally |
| `"input_required"` | Server needs more input; body is an `InputRequiredResult` (see [L4](./04-clients-and-hosts.md)) |

Rules:

- Extensions **MAY** add values, but only ones advertised through capabilities.
- An unrecognised `resultType` **MUST** be treated as invalid.
- A result from an older server with **no** `resultType` **MUST** be treated as `"complete"`.
  This single line is how you write a client that spans protocol eras.

Source: [ResultType](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#resulttype).

---

## 5. Error codes and the allocation policy

MCP reuses standard JSON-RPC codes and partitions the implementation-defined range:

| Range | Status |
| --- | --- |
| `-32700`, `-32600`..`-32603` | Standard JSON-RPC |
| `-32000`..`-32019` | **Legacy.** Do not allocate here; assume no meaning when receiving |
| `-32020`..`-32099` | **Reserved for the MCP spec.** Only emit codes the spec defines |
| outside `-32768`..`-32000` | Yours, for application errors |

Spec-defined MCP codes today:

| Code | Name | When |
| --- | --- | --- |
| `-32020` | `HeaderMismatch` | `MCP-Protocol-Version` header disagrees with `_meta` |
| `-32021` | `MissingRequiredClientCapability` | server needs a capability the client did not declare |
| `-32022` | `UnsupportedProtocolVersion` | server does not implement the requested version |

Retired, must not be emitted by a 2026-07-28 server, but clients **SHOULD** still accept
from older servers:

- `-32002` resource not found (now `-32602`)
- `-32042` URL elicitation required (2025-11-25 only)

Source: [Error codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes).

---

## 6. Version negotiation

Two ways to pick a version:

1. **Optimistic.** Send your preferred version in `_meta` (and, on HTTP, in the
   `MCP-Protocol-Version` header). If the server cannot serve it, it returns
   `UnsupportedProtocolVersionError` listing what it supports; retry with one of those.
2. **Up front.** Call `server/discover`, read `supportedVersions`, choose.

On HTTP the header and the body value **MUST** match, or you get `400` +
`HeaderMismatch`. Servers that still want pre-2025-06-18 clients **MAY** treat a missing
header as `2025-03-26`.

Source: [Versioning and compatibility](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning).

**Design instinct to build:** version support is a product decision with a support cost.
Decide which eras you serve, write a test matrix per era, and put it in your README. See
[`reference/protocol-eras.md`](../reference/protocol-eras.md).

---

## 7. Capabilities

Capabilities say what each side can do. Servers declare theirs in `server/discover`
(`tools`, `resources`, `prompts`, plus `extensions`). Clients declare theirs per request
in `_meta`.

- Server needs something the client did not declare -> `-32021`, never a silent fallback.
- Extensions are negotiated through the `extensions` field on both capability objects
  (see [L7](./07-extensions-and-frontier.md)).
- `listChanged: true` only means "I will notify" - and notifications now only flow to
  clients that opened a `subscriptions/listen` stream and opted into that type.

---

## Drills

1. **Hand-rolled discover (60 min).** Write a stdio server in ~80 lines, no SDK: read
   newline-delimited JSON from stdin, answer `server/discover` and `tools/list`, log
   everything to **stderr** (never stdout). Talk to it with `printf ... | node server.js`.
2. **Malformed request hunt (30 min).** Against your server and one SDK server, send:
   no `_meta`; `_meta` without `protocolVersion`; `id: null`; unknown method; version
   `"1999-01-01"`. Record actual code, message, and HTTP status. Compare to the tables above.
3. **Capability refusal (30 min).** Make a tool that requires `elicitation`. Call it with
   `clientCapabilities: {}` and confirm you return `-32021` with `data.requiredCapabilities`.
4. **Era translation (45 min).** Take a captured 2025-06-18 `initialize` exchange and
   write, by hand, the equivalent 2026-07-28 traffic. Note every field that has no home.

---

## Gotchas

- **stdout is sacred on stdio.** Anything not a JSON-RPC frame breaks the transport. Logs
  go to stderr.
- **Do not cache client identity per connection.** Same connection, different tenants, is legal.
- **`ttlMs` and `cacheScope` are required on list-ish results** (see [L2](./02-server-primitives.md)).
  Forgetting them is the most common 2026-07-28 conformance bug.
- **`instructions` is not a description dump.** It is guidance for the model on ordering
  and choice.
- **Absent `resultType` means complete**, not invalid. Clients that reject it break every
  older server.

---

## Exit test

1. From memory, list the four `_meta` protocol keys, which are required, and what a server
   must return when one is missing.
2. Explain, in plain words, why sessions were removed and what replaced state.
3. Hand-write a `server/discover` request and a valid response, including cache hints.
4. Given `-32020`, `-32021`, `-32022`, `-32602`, `-32002`: name each and say whether a
   modern server may emit it.
5. Hand-craft, with no SDK, a stdio exchange that discovers and then calls a tool.

Projects: [`S04`](../projects/after-l1-foundations.md#s04--bare-metal-json-rpc),
[`S06`](../projects/after-l1-foundations.md#s06--tiny-client-cli).

Next: [L2 - Server primitives](./02-server-primitives.md).
