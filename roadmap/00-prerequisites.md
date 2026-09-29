# L0 - Prerequisites

**Time:** 3-5 days. **Goal:** remove every excuse to hand-wave later.

MCP invents very little. It is JSON-RPC 2.0 for the messages, JSON Schema 2020-12 for the
argument shapes, HTTP + OAuth 2.1 for remote access, and one product idea: split what the
model controls from what the app controls. Learn the borrowed parts properly now and the
protocol will feel small.

---

## 1. JSON-RPC 2.0

MCP messages **MUST** follow [JSON-RPC 2.0](https://www.jsonrpc.org/specification).
There are exactly three shapes.

**Request** - has an `id`, expects an answer:

```json
{ "jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {} }
```

**Response** - same `id`, either `result` or `error`, never both:

```json
{ "jsonrpc": "2.0", "id": 1, "result": { "resultType": "complete", "tools": [] } }
```

**Notification** - no `id`, no answer allowed:

```json
{ "jsonrpc": "2.0", "method": "notifications/progress", "params": { "progress": 1 } }
```

MCP adds two constraints on top of plain JSON-RPC:

- `id` **MUST NOT** be `null` (plain JSON-RPC allows it).
- `id` **MUST NOT** reuse the id of a request that is still outstanding from the same sender.

Error codes you must recognise on sight:

| Code | Meaning | Typical cause in MCP |
| --- | --- | --- |
| `-32700` | Parse error | Broken JSON, or a newline inside a stdio frame |
| `-32600` | Invalid request | Missing `jsonrpc`, `null` id |
| `-32601` | Method not found | Unsupported method; on HTTP this comes with `404` |
| `-32602` | Invalid params | Missing required `_meta` field, bad arguments, unknown resource URI |
| `-32603` | Internal error | Unhandled server exception |

Source: [Base protocol overview](https://modelcontextprotocol.io/specification/2026-07-28/basic/index).

**Drill (30 min).** In a scratch file, write by hand: one request, one success response,
one error response, one notification. Then write the same four as a single newline
delimited stdio stream. No SDK, no copy-paste.

---

## 2. JSON Schema 2020-12

Tool inputs and outputs are described with JSON Schema. MCP defaults to the
[2020-12 dialect](https://json-schema.org/draft/2020-12/schema) when `$schema` is absent,
and implementations **MUST** support at least 2020-12.

Minimum vocabulary you should be able to write from memory:

```json
{
  "type": "object",
  "properties": {
    "query":  { "type": "string", "description": "Full-text search string" },
    "limit":  { "type": "integer", "minimum": 1, "maximum": 100, "default": 20 },
    "status": { "type": "string", "enum": ["open", "closed"] }
  },
  "required": ["query"],
  "additionalProperties": false
}
```

Things that matter specifically in MCP:

- A tool with no parameters still needs an object schema. Prefer
  `{ "type": "object", "additionalProperties": false }`.
- `description` is not decoration. It is the prompt the model reads. Treat every
  `description` as production prompt text.
- 2026-07-28 loosened `inputSchema`/`outputSchema` to allow any 2020-12 keywords, so
  `anyOf`, `oneOf`, `$defs` are legal - but implementations **SHOULD** bound schema depth
  and subschema count, because a hostile schema is a denial-of-service vector against the
  validator.
- `$ref` values that resolve to network URIs **MUST NOT** be dereferenced automatically.

Source: [JSON Schema usage](https://modelcontextprotocol.io/specification/2026-07-28/basic/index#json-schema-usage).

**Drill (45 min).** Write schemas for three tools: `search_orders`, `refund_order`,
`export_report`. For each, write the `description` twice - once the way a REST doc would,
once the way you would explain it to a new teammate in one sentence. Keep the second.

---

## 3. The tool-calling mental model

Before MCP, tool calling was: you send the model a list of function schemas, it replies
"call `search_orders` with these arguments", your code runs it, you feed the output back.

MCP does not change that loop. It standardises **where the list comes from** and **who
runs the call**. That is the entire value proposition.

Full comparison with real frames from OpenAI, Anthropic and MCP, plus the three meanings
of "token" and "session": [`reference/function-calling-vs-mcp.md`](../reference/function-calling-vs-mcp.md).

Three roles, learn the words:

| Role | What it is | Example |
| --- | --- | --- |
| **Host** | The AI application the user talks to | Claude Desktop, an IDE assistant, your agent |
| **Client** | The connector inside the host that speaks MCP to one server | one client per connected server |
| **Server** | The process exposing tools/resources/prompts | your GitHub server, your DB gateway |

And the ownership split that most people get wrong:

| Primitive | Chosen by | Analogy |
| --- | --- | --- |
| Tool | The **model** | a function the model may call |
| Resource | The **application** | a file the app decides to attach |
| Prompt | The **user** | a slash command the user picks |

Source: [Architecture overview](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture).

---

## 4. HTTP and OAuth vocabulary

You do not need to implement OAuth at L0, but you must not be scared of these words at
L5. Skim now, deep-dive later:

- **Resource server** - the thing holding data; your MCP server plays this role.
- **Authorization server (AS)** - the thing issuing tokens; usually not yours.
- **PKCE** - proof that the app that redeems the code is the app that started the flow.
- **Audience** - who a token is *for*. MCP servers **MUST** reject tokens not minted for them.
- **Bearer token** - `Authorization: Bearer <token>`, sent on **every** HTTP request.
- **Protected resource metadata (RFC 9728)** - the `.well-known` document your server
  publishes so clients can find its AS.

Also get comfortable with **SSE** (Server-Sent Events): a `text/event-stream` HTTP
response that stays open and pushes `data:` lines. MCP uses it for streaming a single
request's notifications and for change subscriptions.

---

## 5. Dev environment

Pick one primary language and one secondary. TypeScript first is the pragmatic choice: the
Inspector, most examples, and MCP Apps are JS-shaped.

```bash
# TypeScript
node -v                       # need >= 18, prefer >= 20
npm i @modelcontextprotocol/sdk zod
npm i -D typescript tsx @types/node

# Python (needs >= 3.10; system python on macOS is often 3.9)
uv python install 3.12
uv init && uv add "mcp[cli]"
```

Verified at time of writing: TypeScript SDK `@modelcontextprotocol/sdk@1.30.0`, Python
`mcp` 2.2.0 requiring Python >= 3.10.

Then install the debugger you will live in:

```bash
npx @modelcontextprotocol/inspector            # web UI
npx @modelcontextprotocol/inspector --cli ...  # scriptable, use this in CI
```

The Inspector ships three clients - web, CLI, TUI - and knows how to talk to servers from
different protocol eras. Read
[MCP Inspector](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector) and
[Protocol eras](https://modelcontextprotocol.io/docs/2026-07-28/tools/inspector/protocol-eras).

**Drill (30 min).** Run the Inspector against any published server (for example a
filesystem or fetch example server), then open the raw message pane and read the actual
frames. Do not proceed until the frames look boring.

---

## 6. Reading list for this level

| What | Why |
| --- | --- |
| [JSON-RPC 2.0 spec](https://www.jsonrpc.org/specification) | 20 minutes, whole thing, once |
| [Intro to MCP](https://modelcontextprotocol.io/docs/2026-07-28/getting-started/intro) | Framing and vocabulary |
| [Architecture overview](https://modelcontextprotocol.io/docs/2026-07-28/learn/architecture) | Host/client/server, per-request model |
| [Server concepts](https://modelcontextprotocol.io/docs/2026-07-28/learn/server-concepts) | The three primitives |
| [Client concepts](https://modelcontextprotocol.io/docs/2026-07-28/learn/client-concepts) | What clients owe servers |
| [Base protocol](https://modelcontextprotocol.io/specification/2026-07-28/basic/index) | The only page you will re-read forever |

---

## Gotchas that catch beginners

- **Assuming a session.** There is none in 2026-07-28. A stdio process is not a
  conversation; a client may interleave unrelated requests on it.
- **Confusing `structuredContent` with LLM "structured output".** The first is
  server-produced result data validated against `outputSchema`. The second is model
  generation constrained by a schema. Unrelated.
- **Believing `serverInfo`/`clientInfo`.** Self-reported, unverified, for display and logs
  only. Never a security input.
- **Treating tool `annotations` as trusted.** Clients **MUST** treat annotations as
  untrusted unless the server is trusted.

---

## Exit test

Without notes:

1. Write a valid JSON-RPC request, success response, error response, and notification.
2. Write a 2020-12 schema with an enum, a bounded integer, a required field, and
   `additionalProperties: false`.
3. Explain in three sentences who chooses tools, who chooses resources, who chooses prompts.
4. Name the four JSON-RPC error codes MCP reuses and what each means in MCP terms.

Then start [`S04 Bare-metal JSON-RPC`](../projects/after-l1-foundations.md#s04--bare-metal-json-rpc) and
[`S01 Hello Tools`](../projects/after-l2-primitives.md#s01--hello-tools).

Next: [L1 - Protocol core](./01-protocol-core.md).
