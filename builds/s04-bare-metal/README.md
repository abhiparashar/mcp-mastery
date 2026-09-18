# S04 - Bare-Metal JSON-RPC

Project spec: [`projects/after-l1-foundations.md#s04--bare-metal-json-rpc`](../../projects/after-l1-foundations.md#s04--bare-metal-json-rpc).
Level: [L1 Protocol core](../../roadmap/01-protocol-core.md). Protocol revision: **2026-07-28**.

> **Reference solution, not your build.** This directory was written by the assistant. Write
> your own S04 from the project spec first, then read this one and diff the decisions -
> validation order, cancellation race handling, `requestState` binding. Every project from
> here on is yours to implement.

An MCP server and a caller with **zero dependencies** - no MCP SDK, no HTTP framework, no
JSON Schema library. Every byte on the wire is produced by code in this directory.

```
server.js   the server: stdio transport, envelope validation, 2 tools, MRTR, progress, cancel
frames.js   the client plumbing: spawn, write frames, split stdout, match ids (~110 lines)
caller.js   the demo: 13 wire cases, prints both directions, then a summary table
test.js     19 conformance probes, one wire rule each
```

Run it:

```bash
node caller.js          # the demo above
node --test .           # the conformance probes
printf '{"jsonrpc":"2.0","id":"d1","method":"server/discover","params":{"_meta":{"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientCapabilities":{}}}}\n' | node server.js
```

## Tools, and why these two

| Tool | Shape | Why it exists here |
| --- | --- | --- |
| `text_stats` | `{ text, topWords?, simulateWorkMs? }` -> `{ characters, words, lines, top[] }` | The happy path with teeth: `outputSchema` + `structuredContent` + a text mirror, chunked work so `notifications/progress` and `notifications/cancelled` are real rather than decorative, and one genuine **business** failure (`isError: true`) that is not a protocol error. |
| `purge_cache` | `{ scope: "stale" \| "all" }` -> `{ scope, purgedEntries, confirmed }` | A destructive action, so it **requires** the `elicitation` client capability. That makes `-32021` truthful instead of synthetic, and forces a full MRTR round trip: `input_required` -> client elicits -> retry with `inputResponses` + `requestState` -> `complete`. |

`simulateWorkMs` is an honest knob, not a stub: it only adds a per-chunk delay so progress
and cancellation are observable at human timescales. Everything else is real work.

Two tools, deterministic order, never mutated -> `tools/list` is byte-identical across
calls, which is what makes it cacheable and diffable by a client.

## Wire behaviour: what was sent, what came back

Every row below is produced by `node caller.js` and asserted in `test.js`.

| Request sent | Response | Rule |
| --- | --- | --- |
| `server/discover` | `result.resultType = "complete"`, `supportedVersions`, `capabilities`, `instructions`, `_meta.serverInfo`, `ttlMs=3600000`, `cacheScope="public"` | [Discovery](https://modelcontextprotocol.io/specification/2026-07-28/server/discover), [Caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching) |
| `tools/list` twice | identical bytes, 2 tools, `ttlMs=600000`, `cacheScope="public"` | [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools) |
| `tools/call text_stats` + `progressToken` | `complete`, `structuredContent` mirrored in a text block, `isError=false`, 4 `notifications/progress` | [Progress](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/progress) |
| `tools/call text_stats` with `"!!! ???"` | `complete` with `isError: true` (**not** a JSON-RPC error) | [Tools: error handling](https://modelcontextprotocol.io/specification/2026-07-28/server/tools#error-handling) |
| request with no `params._meta` | `-32602`, `data.missing = [protocolVersion, clientCapabilities]` | [`_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta) |
| `_meta` without `io.modelcontextprotocol/protocolVersion` | `-32602`, `data.missing` names the one key | [`_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta) |
| `_meta` without `io.modelcontextprotocol/clientInfo` | success - `clientInfo` is SHOULD, not MUST | [`_meta`](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#meta) |
| `tools/frobnicate` | `-32601` | [Error codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes) |
| `protocolVersion: "1999-01-01"` | `-32022`, `data.supportedVersions = ["2026-07-28"]` | [Versioning](https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning) |
| `purge_cache` with `clientCapabilities: {}` | `-32021`, `data.requiredCapabilities = ["elicitation"]` | [Error codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes) |
| `purge_cache` with `elicitation` declared | `resultType: "input_required"`, `inputRequests.confirm_purge` (`elicitation/create`), signed `requestState`, **no** cache hints | [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) |
| retry with `inputResponses` + `requestState`, **new id** | `complete`, `structuredContent.purgedEntries = 7` | [MRTR client requirements](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#client-requirements-basic-workflow) |
| retry with `action: "decline"` | `complete`, nothing deleted, `isError=false` | [MRTR](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr) |
| tampered / foreign-key / cross-request `requestState` | `-32602`, message names the failure | [MRTR security](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr#security-considerations) |
| unknown tool, wrong argument type, extra property, out-of-range integer, bad enum | `-32602` | [JSON Schema usage](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#json-schema-usage) |
| `"jsonrpc":"1.0"` / `id: null` / no `method` / top-level array | `-32600` (id echoed when readable) | [Requests](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#requests) |
| `{not json` | `-32700` with `id: null` | [Error codes](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#error-codes) |
| `tools/call` then `notifications/cancelled` | **no response at all**, work stops mid-chunk, transport still usable | [Cancellation](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation) |
| `notifications/cancelled` for an unknown id | ignored silently | [Cancellation: error handling](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/cancellation#error-handling) |

Validation order in `server.js` is deliberate: JSON parse -> JSON-RPC shape -> required
`_meta` -> protocol version -> method dispatch -> capability gate -> argument schema ->
tool. A version this server cannot speak is rejected before the method is even looked up,
because the meaning of a method is defined by the revision.

## Numbers

| Measurement | Value |
| --- | --- |
| `tools/list` payload (`result.tools`) | **1740 bytes**, ~435 tokens at 4 bytes/token |
| Tools exposed | 2 |
| Progress notifications per `text_stats` call | 4 (one per chunk), monotonic, with `total` |
| Cancellation latency | work stops at the next chunk boundary (<= `simulateWorkMs`) |
| Dependencies | 0 |
| Conformance probes | 19, all passing (`node --test .`) |

## How I broke it

Hostile and malformed traffic sent on purpose, with the observed result and the guard that
produces it. Every row is an assertion in `test.js`.

| Attack / malformed input | Observed | Guard |
| --- | --- | --- |
| `"id": null` (legal JSON-RPC, forbidden by MCP) | `-32600`, not treated as a notification | explicit `message.id === null` branch before the notification branch, since `id == null` would also swallow `undefined` |
| `notifications/cancelled` mid-call | no response ever written, `text_stats` stops at the next chunk | flag checked before each chunk (`Cancelled`, nothing sent) **and** again before the write, because cancellation can land between the last chunk and the response |
| progress after the result | never observed: only 4 notifications for 4 chunks | reporter drops non-increasing `progress` and refuses to emit once the id has left `inflight` |
| last 4 chars of `requestState` rewritten | `-32602 requestState failed integrity check` | HMAC-SHA256 compared with `timingSafeEqual` |
| valid `requestState` replayed on `scope: "all"` after being issued for `scope: "stale"` | `-32602 requestState was issued for a different request` | payload binds a SHA-256 digest of method + canonicalised arguments |
| `requestState` from a server started with a different `S04_STATE_KEY` | `-32602 requestState failed integrity check` | per-deployment key; with no key set the server warns on stderr, because a per-process key breaks any retry that lands on another replica |
| `{not json`, `[1,2,3]`, `"jsonrpc":"1.0"`, no `method` | `-32700` / `-32600`, transport survives, later requests still answered | framing and shape checks run before dispatch; one bad line never desynchronises the stream |
| every stdout line parsed as JSON by the caller | zero violations across the whole demo | all logging goes to stderr; `frames.js` records any non-JSON line and `caller.js` exits non-zero |

Two guards that have no attack row because they are structural: `tools/call` results are
validated against the tool's own `outputSchema` before being sent (a violation is `-32603`,
the server's fault, not the client's), and `input_required` results carry no `ttlMs` or
`cacheScope` at all, because MRTR results must never be cached.


## What is deliberately not here

- **No HTTP.** Streamable HTTP, its headers and `-32020` (`HeaderMismatch`) belong to
  [S05](../../projects/after-l3-transports.md#s05--streamable-http-deploy). This server
  therefore never emits `-32020`.
- **No resources or prompts** - that is [S02](../../projects/after-l2-primitives.md#s02--notes-resources)
  and [S03](../../projects/after-l2-primitives.md#s03--prompt-pack).
- **No `notifications/message`.** Logging is deprecated in this revision, and nothing here
  needs it; `io.modelcontextprotocol/logLevel` is accepted and ignored.
- **No pagination.** `tools/list` returns one page and rejects an unknown `cursor` with
  `-32602` rather than pretending it is an empty page.
- **No single-use enforcement on `requestState`.** Bounded by TTL and request binding only;
  true one-shot redemption needs server-side storage, which is an L5/L6 concern.
