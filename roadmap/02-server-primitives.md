# L2 - Server Primitives (tools, resources, prompts)

**Time:** 2 weeks. **Goal:** build servers a model actually uses correctly, not servers
that merely respond.

This level is where engineers separate. Anyone can return a tool list. Very few design a
tool surface that a model picks correctly under pressure, inside a token budget, without
foot-guns.

---

## 1. The ownership split (say it out loud)

| Primitive | Who chooses | Method surface | Failure mode when misused |
| --- | --- | --- | --- |
| **Tools** | the model | `tools/list`, `tools/call` | model calls the wrong thing, or 40 tools eat the context |
| **Resources** | the application | `resources/list`, `resources/templates/list`, `resources/read` | app has no way to attach data, so people fake it with tools |
| **Prompts** | the user | `prompts/list`, `prompts/get` | reusable workflows get buried inside tool descriptions |

If your server exposes `get_file_contents` as a tool but has no resources, you have
probably modelled it wrong. Read
[Server concepts](https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts).

---

## 2. Tools

### Wire basics

`tools/list` supports pagination and caching. `tools/call` takes `name` + `arguments`.

```json
{
  "jsonrpc": "2.0", "id": 1,
  "result": {
    "resultType": "complete",
    "tools": [{
      "name": "search_orders",
      "title": "Search orders",
      "description": "Find orders by customer email or order id. Returns at most 20 rows.",
      "inputSchema": {
        "type": "object",
        "properties": { "query": { "type": "string", "description": "email or order id" } },
        "required": ["query"],
        "additionalProperties": false
      },
      "outputSchema": { "type": "object", "properties": { "orders": { "type": "array" } }, "required": ["orders"] }
    }],
    "nextCursor": "opaque",
    "ttlMs": 300000,
    "cacheScope": "public"
  }
}
```

### Rules that bite

- Servers supporting tools **MUST** declare the `tools` capability.
- The tool set **MUST NOT** vary per connection or as a side effect of other requests. It
  **MAY** vary by the authorization presented on the request - credentials are per-request
  input, not connection state.
- Servers **SHOULD** return tools in a **deterministic order**. Stable order = client cache
  hits and LLM prompt-cache hits.
- `inputSchema` **MUST** be a valid JSON Schema object, never `null`. No parameters means
  `{ "type": "object", "additionalProperties": false }`.
- If you publish `outputSchema`, your `structuredContent` **MUST** conform; clients
  **SHOULD** validate it.
- Tool names: 1-128 chars, `A-Z a-z 0-9 _ - .`, case-sensitive, unique per server. Names
  are only unique *within* a server, so aggregators/proxies **SHOULD** namespace
  (`github.search`), and **MUST NOT** rely on `serverInfo.name` for that, since it is not
  unique.
- `annotations` are **untrusted** unless the server is trusted. Never let an annotation
  drive a security decision.

Source: [Tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools).

### Result shapes

- **Unstructured** `content[]`: `text`, `image`, `audio`, `resource_link`, `resource`.
- **Structured** `structuredContent`: any JSON value matching `outputSchema`. For
  backwards compatibility also mirror the JSON into a text block.
- **Tool errors are not protocol errors.** A failed tool call is a normal result with
  `isError: true` and an explanation in `content`, so the model can read it and recover. A
  JSON-RPC error means "the request itself was invalid" (unknown tool, bad params). Getting
  this backwards is the single most common design bug in the wild.
- `resource_link` lets a tool point at data instead of inlining it. Use it whenever the
  payload is big; links returned by tools are not required to appear in `resources/list`.

### `x-mcp-header` (new, and easy interview points)

A property in `inputSchema` may carry `x-mcp-header: "Region"`. On Streamable HTTP the
client mirrors that argument into `Mcp-Param-Region`, so load balancers and WAFs can route
without parsing the body. Constraints: primitive types only (`integer`, `string`,
`boolean`; **not** `number`), non-empty HTTP token syntax, no CR/LF, case-insensitively
unique in the schema, statically reachable from the schema root. Clients **MUST** reject
(exclude from `tools/list`) tools that violate this, and **SHOULD** log why. Never mark
secrets or PII with it - intermediaries see headers.

### Tool design: the part nobody teaches

Design rules that survive contact with real models:

1. **Task-shaped, not endpoint-shaped.** `refund_order(order_id, reason)` beats
   `post_payments_v2_refunds(body)`. One tool per *user intention*.
2. **Fewer tools wins.** Every tool costs tokens on every turn and adds a wrong choice.
   Ten sharp tools beat forty complete ones. When accuracy drops, delete tools before you
   tune prompts.
3. **The description is a prompt.** State what it does, when to use it, when *not* to,
   limits, and side effects. One or two sentences. Put ordering hints in server
   `instructions` (returned by `server/discover`).
4. **Constrain in the schema, not the prose.** `enum`, `minimum`, `maximum`, `default`,
   `additionalProperties: false`. Models respect schemas more reliably than sentences.
5. **Cap output.** Page it, truncate it, or return a `resource_link`. A tool that can
   return 200 KB of JSON will one day blow the context window in front of a customer.
6. **Make errors instructive.** `isError: true` plus "order not found; call search_orders
   first to get an id" is a tool that repairs its own misuse.
7. **Say destructive out loud.** Destructive or costly actions belong behind explicit
   confirmation; the spec says hosts **SHOULD** keep a human in the loop, and your
   description should make the stakes obvious.
8. **Idempotency where possible.** Models retry. Accept an idempotency key for anything
   that writes.

---

## 3. Resources

Data addressed by URI, chosen by the app.

- Capability flags: `listChanged` (list changes) and `subscribe` (per-resource updates
  delivered through `subscriptions/listen` with the `resourceSubscriptions` filter).
  Declare either, both, or neither.
- `resources/list` -> `{ uri, name, title?, description?, mimeType?, icons? }[]`, paginated
  and cacheable. Same per-connection invariance rule as tools; may vary by authorization.
- `resources/read` -> `contents[]`, each with `uri`, `mimeType`, and `text` or `blob`. One
  read **MAY** return several contents (e.g. reading a directory).
- `resources/templates/list` -> RFC 6570 URI templates like `file:///{path}` or
  `db://{schema}/{table}`. Template arguments can be auto-completed via `completion/complete`.
- Annotations on contents: `audience` (`user` / `assistant`), `priority`, `lastModified` -
  hints so hosts can decide what to show the model.
- Not-found is now `-32602` (Invalid params). Clients **SHOULD** still accept `-32002`
  from older servers.

Source: [Resources](https://modelcontextprotocol.io/specification/2026-07-28/server/resources).

**URI scheme design is a skill.** Pick a scheme that is stable, hierarchical, and
guessable: `repo://owner/name/blob/main/src/app.ts`, `db://analytics/public/orders`.
Templates plus completion turn your URI scheme into a browsable API. Bad URI design shows
up later as unfixable client UX.

---

## 4. Prompts

User-selected templates, usually surfaced as slash commands.

- `prompts/list` -> `{ name, title?, description?, arguments? }[]`, paginated, cacheable.
- `prompts/get` -> `messages[]` with `role` and `content`, ready to inject.
- Arguments support completion via `completion/complete`.
- `prompts/get` **MAY** return `input_required` (MRTR), so a prompt can ask the user
  something before it renders.

Use prompts for the workflows your users repeat: "review this PR against our style guide",
"write the incident postmortem from these logs". This is the cheapest quality win in MCP
and the most ignored primitive.

Source: [Prompts](https://modelcontextprotocol.io/specification/2026-07-28/server/prompts).

---

## 5. Pagination

Opaque cursors, not offsets.

- Server returns `nextCursor`; client passes it back as `params.cursor`.
- Clients **MUST** treat cursors as opaque - no parsing, no arithmetic.
- No cross-page consistency guarantee: data can change between pages. A client that needs
  a snapshot re-fetches from the beginning without a cursor.
- If a cursor goes invalid, discard cached pages and restart.

Source: [Pagination](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/pagination).

---

## 6. Caching (`ttlMs`, `cacheScope`) - new and mandatory

Servers **MUST** include cache hints on `resultType: "complete"` results for:
`server/discover`, `tools/list`, `prompts/list`, `resources/list`,
`resources/templates/list`, `resources/read`.

| Field | Meaning |
| --- | --- |
| `ttlMs` | Freshness hint in milliseconds, like `Cache-Control: max-age`. **MUST** be >= 0. `0` = immediately stale. Absent = treat as `0` (only happens with older servers). Negative = ignore, treat as `0`. |
| `cacheScope` | `"public"` = no user-specific data, any client or shared proxy may serve it to anyone. `"private"` = reusable only within the same authorization context. |

Rules that catch people:

- `input_required` results are **not** cacheable and carry no hints.
- Results produced by an MRTR retry (carrying `inputResponses` or `requestState`) **MUST
  NOT** be cached.
- Cache key = method + the params that affect the result (`uri`, `cursor`, ...).
- Each page carries its own TTL; all pages of one list **MUST** share the same `cacheScope`.
- TTL is not a polling interval. Clients check freshness on access; if they do poll they
  **MUST** jitter and back off.
- A `listChanged` notification **invalidates** a fresh cache immediately. TTL and
  notifications are complementary.
- Security: `"public"` results can leak across authorization contexts even from an
  authenticated endpoint. `cacheScope` is **not** an access control. Enforce per-primitive
  authorization on every request.

Source: [Caching](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/caching).

---

## 7. Completion

`completion/complete` gives argument autocomplete for prompt arguments and resource
template variables. It is what makes a resource-heavy server feel like a real product
instead of a form. Implement it for anything with an id, a path, or an enum-like space.

Source: [Completion](https://modelcontextprotocol.io/specification/2026-07-28/server/utilities/completion).

---

## Drills

1. **Cut the surface (90 min).** Take a REST API with 20 endpoints. Design an MCP server
   with at most 6 tools. Write one paragraph per removed endpoint saying why it is not a
   tool (resource? prompt? argument? not needed?).
2. **Selection accuracy harness (2-3 h).** Write 30 user requests with the tool you
   expect. Run them through a model with your `tools/list` payload. Score accuracy. Then
   change *only* names and descriptions and re-score. Keep the number in your README - this
   single artifact puts you ahead of nearly everyone.
3. **Token audit (45 min).** Measure the byte and token size of your `tools/list`. Set a
   budget (for example 1500 tokens) and get under it.
4. **Cache correctness (60 min).** Add `ttlMs`/`cacheScope` everywhere required. Then prove
   with the Inspector CLI that a `private` result never gets reused across two different
   tokens in your own client cache.
5. **Error ergonomics (45 min).** For each tool, force its three most likely failures.
   Rewrite each message until a model can self-correct from it alone.

---

## Gotchas

- Returning a JSON-RPC error for a business failure. Use `isError: true` instead.
- Tool lists that vary per connection. Illegal, and it breaks caching.
- Non-deterministic ordering (for example iterating a hash map). Kills prompt caching.
- Dumping raw API JSON as the tool result. Shape it for a reader with a token budget.
- Forgetting `ttlMs`/`cacheScope`. Silent conformance failure in 2026-07-28.
- Using `x-mcp-header` on a secret, or on a `number` property.
- No `outputSchema` on tools whose output feeds code paths downstream.

---

## Exit test

1. Explain the tool/resource/prompt split and give a real example of each from one product.
2. State the difference between a tool error and a protocol error, with the exact wire shape.
3. Name the six operations that **MUST** carry cache hints, and both hint fields' rules.
4. Show your tool-selection accuracy number, before and after a description rewrite.
5. Your `tools/list` fits your stated token budget and is byte-identical across two calls.

Projects: [`S01`](../projects/after-l2-primitives.md#s01--hello-tools),
[`S02`](../projects/after-l2-primitives.md#s02--notes-resources),
[`S03`](../projects/after-l2-primitives.md#s03--prompt-pack).

Next: [L3 - Transports](./03-transports.md).
