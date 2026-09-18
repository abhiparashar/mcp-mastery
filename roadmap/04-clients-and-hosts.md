# L4 - Clients and Hosts (including MRTR)

**Time:** 2 weeks. **Goal:** stop being only a server author. The scarce skill is building
the side that decides *which* context reaches the model.

Almost everyone learns MCP from the server side. Hosts are where the hard product
decisions live: tool budgets, caching, trust, and the multi round-trip dance.

---

## 1. Host, client, server

- **Host**: the AI application. Owns the model, the conversation, consent UI, and the
  policy about what the model may see or do.
- **Client**: one connector per server, inside the host. Speaks MCP.
- **Server**: exposes tools/resources/prompts.

A host with 12 connected servers has 12 clients. Everything hard happens in the host:
merging tool lists, namespacing collisions, budgeting tokens, deciding when to re-fetch.

Read [Client concepts](https://modelcontextprotocol.io/docs/2026-07-28/learn/client-concepts)
and [Client best practices](https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices).

---

## 2. What a correct client must do (2026-07-28)

Checklist - every line is a real requirement or a real production need:

1. Put `io.modelcontextprotocol/protocolVersion` and
   `io.modelcontextprotocol/clientCapabilities` in `_meta` on **every** request; add
   `clientInfo` unless configured otherwise.
2. On HTTP, send `MCP-Protocol-Version`, `Mcp-Method`, and `Mcp-Name` (for `tools/call`,
   `resources/read`, `prompts/get`), and keep the header equal to the body value.
3. Accept both `application/json` and `text/event-stream` responses.
4. Read `resultType`. Treat **absent** as `"complete"` (older servers). Treat unknown
   values as invalid.
5. Handle `UnsupportedProtocolVersion` (`-32022`) by retrying with a version from the
   error, or call `server/discover` up front.
6. Honour `ttlMs` / `cacheScope`. Never share a `private` result across authorization
   contexts. Never cache `input_required` results or MRTR retries.
7. Cache `tools/list` and invalidate on `notifications/tools/list_changed` - which you only
   get if you opened `subscriptions/listen` and opted in.
8. Never reuse an outstanding JSON-RPC id; use a **new** id when re-issuing after a broken
   stream.
9. Clients on Streamable HTTP **MUST** reject tool definitions with invalid
   `x-mcp-header` values: exclude that tool from `tools/list`, and log why. Clients on
   other transports, including stdio, **MAY** ignore `x-mcp-header` annotations entirely
   ([`x-mcp-header`](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#x-mcp-header)).
10. Treat tool `annotations`, `serverInfo`, and descriptions as **untrusted content**.
11. Keep a human in the loop for tool invocation, and show which tools are exposed.
12. Validate `structuredContent` against `outputSchema` when present.

---

## 3. MRTR: Multi Round-Trip Requests

The biggest breaking change of this revision. Servers **MUST NOT** send server-initiated
requests any more. Instead they answer with a result that says "I need input".

### Shape

```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "resultType": "input_required",
    "inputRequests": {
      "github_login": {
        "method": "elicitation/create",
        "params": {
          "mode": "form",
          "message": "Please provide your GitHub username",
          "requestedSchema": { "type": "object", "properties": { "name": { "type": "string" } }, "required": ["name"] }
        }
      }
    },
    "requestState": "AEAD-protected blob"
  }
}
```

The client gathers the input and **retries the original request** with a **new id**:

```json
{
  "jsonrpc": "2.0", "id": 2,
  "method": "tools/call",
  "params": {
    "name": "get_weather",
    "arguments": { "location": "New York" },
    "inputResponses": { "github_login": { "action": "accept", "content": { "name": "octocat" } } },
    "requestState": "AEAD-protected blob"
  }
}
```

### Rules

- Allowed only on `tools/call`, `resources/read`, `prompts/get`. Nowhere else.
- `inputRequests` values **MUST** be `ElicitRequest`, `CreateMessageRequest`, or
  `ListRootsRequest`. Keys are server-chosen and unique within the request.
- A server **MUST NOT** request something the client did not declare in capabilities (no
  `elicitation/create` to a client without `elicitation`).
- Every `InputRequiredResult` **MUST** contain at least one of `inputRequests` or
  `requestState`.
- If an `InputRequiredResult` carries only `requestState` and no `inputRequests`, the
  client **MAY** retry the original request immediately without gathering anything.
- Client **MUST** echo `requestState` byte-for-byte, **MUST NOT** inspect or modify it, and
  **MUST NOT** invent one if the server did not send one.
- The retry **MUST** use a different JSON-RPC id: these are independent requests.
- `inputRequests`/`requestState` apply only to the retry of that request, never to other
  in-flight requests.
- Servers **MUST NOT** assume the client will comply, and **MAY** return
  `input_required` again (multiple rounds are legal).
- If the client omits needed data, the server **SHOULD** ask again rather than error.

### `requestState` security (this is the interview question)

`requestState` travels through the client, so it is **attacker-controlled input**. If it
influences authorization, resource access, or business logic, the server **MUST** protect
integrity (HMAC or AEAD) and **MUST** reject state that fails verification. To bound
replay, servers **SHOULD** embed and verify:

- the authenticated principal (reject if a different principal presents it),
- a short TTL (reject when lapsed),
- an identifier of the originating request - method name plus a digest of salient params
  (reject if it does not match).

Those bound cross-user and cross-request reuse but do not guarantee single use. Servers
for which a given `requestState` must be consumed at most once (a one-time redemption)
**MUST** enforce that invariant server-side.

Source: [Multi Round-Trip Requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr).

**Why this design is good, in one sentence:** the server needs no shared session store and
no sticky load balancing, because all continuation state rides in a signed blob through
the client.

---

## 4. Elicitation, sampling, roots - current status

| Feature | Status in 2026-07-28 | What to do |
| --- | --- | --- |
| **Elicitation** | Active, delivered via MRTR. `mode: "form"` with a `requestedSchema`, or URL mode for out-of-band flows | Implement in your host; it is the polite way to ask users for missing input |
| **Sampling** | **Deprecated** (still functional during the window) | New code should call the LLM provider directly instead of asking the client to sample |
| **Roots** | **Deprecated** | Pass directories/files as tool parameters, resource URIs, or server config |
| **Logging feature** | **Deprecated** | stderr on stdio, OpenTelemetry remotely |

Mode choice is not only UX. Servers **MUST NOT** use form mode to request sensitive
credentials - passwords, API keys, access tokens, payment credentials - and **MUST** use
URL mode for those, because URL-mode data never passes through the client.

Source: [Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation).

Also gone in this revision: `notifications/elicitation/complete` and the `elicitationId`
field of URL-mode elicitation. Under MRTR the client learns the outcome by **retrying**;
servers that need to correlate encode their own id inside `requestState`.

Deprecated features get a minimum 12-month window under the
[feature lifecycle policy](https://modelcontextprotocol.io/community/feature-lifecycle),
tracked in the
[deprecated registry](https://modelcontextprotocol.io/specification/2026-07-28/deprecated).
Knowing what is on the way out is half of good architecture.

---

## 5. Host design at scale

Problems you will hit with more than three servers:

| Problem | Fix |
| --- | --- |
| 200 tools blow the context window | Tool filtering per task; expose a curated subset; let the user enable groups |
| Two servers both expose `search` | Namespace with a server prefix; never trust `serverInfo.name` for uniqueness |
| Re-fetching lists every turn | Honour `ttlMs`, cache per `cacheScope`, invalidate on `list_changed` |
| One slow server stalls the turn | Per-server timeouts and circuit breakers; degrade, do not block |
| A server returns 500 KB | Truncate at the client boundary and tell the model it was truncated |
| Malicious tool description | Treat as untrusted text; never let it change host policy; show diffs when a tool list changes |
| Cost blowout | Per-turn budgets: max tool calls, max tokens per result, max wall clock |

A host that does the first three well already beats most shipping products.

---

## 6. Tooling: the Inspector is not optional

The Inspector ships three clients - web UI, CLI, TUI - plus documented behaviour across
protocol eras.

```bash
npx @modelcontextprotocol/inspector                        # web UI
npx @modelcontextprotocol/inspector --cli node server.js   # scriptable
```

Use the **CLI in CI**: methods, output formats and exit codes are documented, which makes
it a conformance harness you did not have to write. Read
[Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector),
[CLI client](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/cli), and
[Protocol eras](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/protocol-eras).

---

## Drills

1. **Client from scratch (4-6 h).** No SDK. stdio + HTTP. `server/discover`, `tools/list`,
   `tools/call`, version fallback, cache honouring, `resultType` handling. This is the
   single most educational exercise in the whole roadmap.
2. **MRTR both sides (3 h).** Server returns `input_required` asking for a value; client
   elicits from the terminal and retries with a new id. Then sign `requestState` with HMAC
   including principal, TTL and request digest.
3. **Tamper test (45 min).** Flip one byte of `requestState`. Confirm rejection. Replay a
   valid state as a different principal. Confirm rejection.
4. **Budget enforcement (2 h).** Add per-turn limits to your host: max 5 tool calls, max
   8 KB per result, 20 s wall clock. Show a transcript where limits fire cleanly.
5. **Era compatibility (2 h).** Point your client at a 2025-06-18-era server and a
   2026-07-28 server. Same client, both work, no branches sprinkled through business logic
   - keep era handling in one adapter.

---

## Gotchas

- Reusing the JSON-RPC id on an MRTR retry. Illegal.
- Inspecting or "fixing" `requestState`. Illegal, and it will break signing.
- Sending `inputResponses` for requests the server did not ask for.
- Sending an `elicitation/create` input request to a client without the `elicitation`
  capability. Return `-32021` instead, or design the tool not to need it.
- Building new features on Sampling or Roots. Both deprecated.
- Trusting tool descriptions. They are attacker-controllable text inside your prompt.
- Sharing a `private` cached result across two users. Data leak.

---

## Exit test

1. Implement MRTR end to end and explain every field on the wire.
2. Explain the three things to embed in `requestState` and the attack each stops.
3. Name the deprecated client features and their replacements.
4. Show your own client passing against two servers from different protocol eras.
5. Describe your host's tool-budget policy with numbers.

Projects: [`S06`](../projects/after-l1-foundations.md#s06--tiny-client-cli),
[`S09`](../projects/after-l4-clients.md#s09--mrtr-elicitation),
[`M05`](../projects/after-l4-clients.md#m05--mcp-gatewayrouter).

Next: [L5 - Auth and security](./05-auth-and-security.md).
