# Build after L2 - Server primitives

Concepts required: [L2 Server primitives](../roadmap/02-server-primitives.md).

This is where you build taste. Every project here is judged on **how a model behaves with
your server**, not on whether the server responds.

---

### S01 — Hello Tools

- **Size:** `[S]` half a day
- **Unlocked after:** L2 (may be started right after L1 with the SDK)
- **Concepts:** tools capability, schemas, tool errors vs protocol errors, deterministic
  ordering, cache hints

**Goal.** Your first real SDK server: three tools, correct in every detail a reviewer would
check.

**Requirements**

1. Three tools with genuinely different shapes: a pure computation, a read from local
   state, and one that can fail for business reasons.
2. Schemas use `enum`, bounds, `default`, and `additionalProperties: false`. The
   no-argument case (if any) uses `{ "type": "object", "additionalProperties": false }`.
3. Business failures return `isError: true` with a message a model can recover from.
   Unknown tool or bad params return JSON-RPC errors.
4. One tool publishes an `outputSchema` and returns matching `structuredContent`, mirrored
   as JSON text for older clients.
5. `tools/list` is deterministically ordered and carries `ttlMs` + `cacheScope`.
6. `server/discover` returns useful `instructions` telling the model the call order.

**Acceptance**

- Inspector shows all three tools; each is callable; the failing path shows `isError` and
  not a red protocol error.
- Two consecutive `tools/list` responses are byte-identical.
- README records the `tools/list` size in bytes and estimated tokens.

**Stretch.** Add an `icons` entry and verify a client renders it, respecting the HTTPS/data
URI rule.

**Mastery marker.** Your README explains why each tool exists **and** names one API
operation you deliberately did not expose.

---

### S02 — Notes Resources

- **Size:** `[S]` one day
- **Unlocked after:** L2
- **Concepts:** resources, URI templates, pagination, `resources/read`, caching scope,
  completion

**Goal.** A notes/files server where the interesting surface is **resources**, not tools.

**Requirements**

1. `resources/list` over at least 60 items so pagination is real; opaque `nextCursor`.
2. `resources/templates/list` with an RFC 6570 template such as `notes://{folder}/{slug}`.
3. `completion/complete` for the template variables.
4. `resources/read` returns `contents[]` with correct `mimeType`; one URI returns multiple
   contents (a folder read).
5. Cache hints everywhere required: `public` for the template list, `private` for
   user-scoped reads, per-page `ttlMs`, one `cacheScope` for all pages of a list.
6. Unknown URI -> `-32602` (and the README notes that older servers used `-32002`).
7. Exactly one write path exposed as a **tool** (`create_note`), with `resourcesListChanged`
   emitted for listeners.

**Acceptance**

- Walk all pages via the Inspector and reach the end without duplicates.
- Completion suggests real folders as you type.
- A `private` read is never served from cache to a second credential in your S06 client.

**Stretch.** Add a `search_notes` tool that returns `resource_link` items instead of inline
text, and measure the token saving.

**Mastery marker.** Your URI scheme is guessable and stable, and you can defend it against
two alternatives.

---

### S03 — Prompt Pack

- **Size:** `[S]` half a day
- **Unlocked after:** L2
- **Concepts:** prompts, arguments, completion, prompts as workflows

**Goal.** Turn three repeated workflows you personally do into prompts.

**Requirements**

1. Three prompts with arguments, titles and descriptions; `prompts/list` paginated and
   cacheable.
2. `prompts/get` returns well-formed `messages[]` with correct roles.
3. Argument completion via `completion/complete` for at least one argument.
4. One prompt composes with a resource: it embeds resource content rather than restating it.
5. README shows before/after transcripts proving the prompt beats free-typing.

**Acceptance**

- The prompts appear as pickable commands in a host and produce usable output on first try.
- One prompt takes an argument whose completion suggests real values.

**Stretch.** Make one prompt return `input_required` (MRTR) to ask the user for a missing
argument, then complete on retry.

**Mastery marker.** You can explain why each of these is a prompt rather than a tool.

---

### M01 — Read-Only DB Gateway

- **Size:** `[M]` one to two weeks
- **Unlocked after:** L2 (harden it again after [L6](../roadmap/06-production-and-scale.md))
- **Concepts:** safe tool design, resources for schema, output limits, auditability

**Goal.** Let an agent answer questions over a real database without ever being able to
damage or drain it.

**Requirements**

1. Read-only by construction: a read-only DB role, plus statement inspection. Reject
   anything that is not a single `SELECT`/`WITH` statement.
2. Tools, task-shaped: `list_tables`, `describe_table`, `run_query`,
   `sample_rows`. `run_query` enforces `LIMIT`, a row cap, a byte cap, and a statement
   timeout.
3. Schema exposed as **resources** (`db://{schema}/{table}`) with templates and completion,
   so hosts can attach schema without a tool call.
4. Every result states what was truncated and why, in text the model can act on.
5. Audit log per call: principal, tool, arguments (redacted), rows returned, duration.
6. `structuredContent` with an `outputSchema` for `run_query` (columns + rows + truncated
   flag).
7. Cache hints: `public` on `list_tables`/templates, `private` on anything user-scoped.
8. A written threat-model table (see [L5](../roadmap/05-auth-and-security.md#4-threat-model-template-use-this-do-not-improvise)).

**Acceptance**

- Ten hostile prompts ("drop the users table", "select * from orders" with 5M rows,
  "read /etc/passwd") all fail safely, and the transcript is in the README.
- p95 latency and the row/byte caps are documented numbers.
- Tool-selection accuracy measured over 30 natural questions.

**Stretch.** Add query plan inspection (`EXPLAIN`) as a tool and refuse queries above a
cost threshold with an explanatory error.

**Mastery marker.** Safety comes from the database role and hard caps, not from prompt
wording.
