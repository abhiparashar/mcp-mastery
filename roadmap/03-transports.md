# L3 - Transports (stdio and Streamable HTTP)

**Time:** 1.5 weeks. **Goal:** run the same server locally and remotely, survive proxies,
and prove streaming and cancellation actually work.

Two transports exist in 2026-07-28: **stdio** for local child processes, **Streamable
HTTP** for everything remote. The old HTTP+SSE transport (2024-11-05) is deprecated.

---

## 1. stdio

The client launches your server as a subprocess and talks over stdin/stdout.

- Messages are newline-delimited JSON. A message **MUST NOT** contain embedded newlines.
- stdout carries **only** JSON-RPC frames. Logging goes to **stderr**. One stray
  `console.log` corrupts the stream - the classic first-day bug.
- The process is not a session. Unrelated requests may be interleaved on it, and clients
  **SHOULD NOT** tie process lifetime to a conversation.
- `notifications/cancelled` is used **only** on stdio (on HTTP, closing the stream is the
  cancel signal).
- Backwards compatibility: a client that supports both modern and legacy servers **SHOULD**
  send `server/discover` first, because stdio has no HTTP status code to drive fallback.
  Failure means "probably a pre-2026-07-28 server; try `initialize`".
- Credentials come from the **environment**, not from the OAuth flow. Do not implement the
  authorization spec on stdio.

Source: [stdio](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/stdio).

Local-install security matters here: a stdio server is arbitrary code running with the
user's rights. Pin versions, verify publishers, avoid `npx`-latest in production configs.

---

## 2. Streamable HTTP

One endpoint, POST only. This is the transport that changed most.

### The rules

1. Server exposes a single **MCP endpoint** path (e.g. `https://example.com/mcp`) that
   supports POST.
2. Every JSON-RPC message from the client is its **own** HTTP POST.
3. Client **MUST** send `Accept: application/json, text/event-stream` and **MUST** support
   both response types.
4. Request body is a single JSON-RPC request or notification. Clients **MUST NOT** POST
   JSON-RPC *responses*.
5. Notification POST -> `202 Accepted`, no body (or an HTTP error if unacceptable).
6. Request POST -> either `application/json` with one object, or `text/event-stream` with a
   stream scoped to that request.
7. On an SSE response stream the server **MAY** send notifications belonging to that
   request (`notifications/progress`, `notifications/message`) and then the final response,
   which **SHOULD** close the stream. The server **MUST NOT** send independent JSON-RPC
   requests on it.
8. `Last-Event-ID` resumability is **gone**. If a stream breaks, the in-flight request is
   lost; the client **MUST** re-issue it as a new request with a **new id**.

### Headers

| Header | Required | Notes |
| --- | --- | --- |
| `MCP-Protocol-Version` | Yes, every POST | **MUST** equal `_meta['io.modelcontextprotocol/protocolVersion']`; mismatch -> `400` + `HeaderMismatch` (`-32020`) |
| `Mcp-Method` | Yes | mirrors `method` |
| `Mcp-Name` | For `tools/call`, `resources/read`, `prompts/get` | mirrors `params.name` or `params.uri` |
| `Mcp-Param-{Name}` | When a tool uses `x-mcp-header` | mirrors that argument's value |
| `Authorization: Bearer ...` | When protected | on **every** request |

Why headers exist: intermediaries route, rate-limit, cache and observe without parsing
bodies. This is the design that lets you put a normal gateway in front of MCP.

### Status codes to get right

| Situation | Status | Body |
| --- | --- | --- |
| Unknown method | `404` | JSON-RPC error `-32601` (distinguishes you from a legacy HTTP+SSE 404) |
| Version not supported | `400` | `UnsupportedProtocolVersionError` (`-32022`) listing supported versions |
| Header/body version mismatch | `400` | `HeaderMismatch` (`-32020`) |
| Missing required `_meta` | `400` | `-32602` |
| Client capability missing | `400` | `-32021` with `data.requiredCapabilities` |
| Bad/expired token | `401` | plus `WWW-Authenticate` (see [L5](./05-auth-and-security.md)) |
| Invalid `Origin` | `403` | optionally a JSON-RPC error with no `id` |

### Operating a stream through real infrastructure

- Send `X-Accel-Buffering: no` on SSE responses so nginx and friends stop buffering.
- Emit SSE comment lines (`:\r\n`) periodically as keep-alive on long-lived streams,
  especially `subscriptions/listen`. Clients **MUST** ignore comments.
- Validate `Origin` on every connection to stop DNS rebinding; bind to `127.0.0.1` when
  local; authenticate everything else.

Source: [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http).

---

## 3. Subscriptions: `subscriptions/listen`

One request replaces the old GET stream, `resources/subscribe` and `resources/unsubscribe`.

- Client POSTs `subscriptions/listen` and opts into notification types:
  `toolsListChanged`, `promptsListChanged`, `resourcesListChanged`, and
  `resourceSubscriptions` (a list of resource URIs).
- The server acknowledges (`notifications/subscriptions/acknowledged`) and keeps the
  response stream open.
- Every notification on that stream **MUST** carry
  `_meta['io.modelcontextprotocol/subscriptionId']` so the client can correlate it.
- Request-scoped notifications (`notifications/progress`, `notifications/message`) do
  **not** appear here. They ride the response stream of the request they belong to.
- Cancel a subscription by closing the stream.

Source: [Subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions).

Design consequence: change notifications are now **opt-in per client**, so a server that
declares `listChanged: true` may have zero listeners. Never build correctness on a
notification being received; TTL-based freshness is the backstop.

---

## 4. Progress

- Client opts in by putting `progressToken` in the request's `_meta`.
- Server sends `notifications/progress` with `progressToken`, `progress`, optional `total`
  and `message`, on that request's stream.
- No token, no progress notifications. Do not spam a client that did not ask.

Source: [Progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress).

Practical rule: emit progress on anything that can exceed ~2 seconds, and make `message`
human-readable ("scanned 1200/5000 files"), because hosts show it to users.

---

## 5. Cancellation

| Transport | How | Server duty |
| --- | --- | --- |
| Streamable HTTP | Client closes the SSE response stream | **MUST** treat as cancellation of that request, stop work as soon as practical, send nothing further for it |
| stdio | `notifications/cancelled` with the `requestId` | same |

Because each HTTP request has its own stream, a disconnect is unambiguous - which is
precisely why sessions and multiplexed streams were removed.

Source: [Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation).

Your job: make cancellation *real*. Thread an `AbortSignal` (or context) from the request
into every downstream call. A server that ignores cancellation burns money on abandoned
work and is trivially DoS-able.

---

## 6. Logging

- No `logging/setLevel` anymore. The client sets `io.modelcontextprotocol/logLevel` in
  `_meta` per request.
- Servers **MUST NOT** emit `notifications/message` for requests that did not include that
  field.
- The Logging feature itself is deprecated: prefer stderr on stdio, and OpenTelemetry for
  remote servers.

Source: [Logging](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/logging).

---

## Drills

1. **One core, two transports (2 h).** Factor your server so tool handlers know nothing
   about transport. Run the same handlers under stdio and Streamable HTTP; prove parity
   with the same Inspector CLI script against both.
2. **Header conformance (45 min).** With `curl`, send: correct headers; mismatched
   `MCP-Protocol-Version`; missing `Mcp-Method`; unknown method; unsupported version.
   Assert status code and JSON-RPC code for each.
3. **Proxy reality check (2 h).** Put nginx in front. Reproduce buffered SSE, then fix it
   with `X-Accel-Buffering: no`. Set a 30 s proxy idle timeout, watch a quiet
   `subscriptions/listen` stream die, then fix it with keep-alive comments.
4. **Cancellation proof (60 min).** Long tool, client aborts at 1 s. Log downstream work
   after abort. Iterate until the log is empty.
5. **Stream-death recovery (45 min).** Kill the stream mid-call. Confirm your client
   re-issues with a **new** id and does not wait for resumption.

---

## Gotchas

- `console.log` on stdio. Corrupts the frame stream.
- Expecting a GET SSE endpoint or `Mcp-Session-Id`. Both removed in 2026-07-28.
- Retrying a broken stream with the **same** JSON-RPC id.
- Sending progress without a `progressToken`.
- Emitting logs to a client that never set `logLevel`.
- Putting request-scoped notifications on the `subscriptions/listen` stream.
- Binding a local server to `0.0.0.0` and skipping `Origin` validation.
- Assuming `text/event-stream` is always used; a server may answer any request with plain
  JSON, and clients **MUST** handle both.

---

## Exit test

1. Draw the three Streamable HTTP flows: simple JSON response, SSE response with progress,
   `subscriptions/listen`.
2. State every required header and what happens when each is wrong.
3. Explain how cancellation works on each transport and why HTTP needs no message.
4. Demonstrate a live server behind a proxy streaming progress, then cancel it and show no
   further work happens.

Projects: [`S05`](../projects/after-l3-transports.md#s05--streamable-http-deploy),
[`S07`](../projects/after-l3-transports.md#s07--progress-and-cancel),
[`S08`](../projects/after-l3-transports.md#s08--subscriptions-watcher).

Next: [L4 - Clients and hosts](./04-clients-and-hosts.md).
