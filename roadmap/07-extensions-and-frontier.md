# L7 - Extensions and the Frontier

**Time:** 1.5 weeks. **Goal:** work at the edge of the protocol without leaving it.

2026-07-28 shrank the core and formalised an **extensions** framework. Long-running tasks,
interactive UI, and machine-to-machine auth now live outside the core, negotiated through
capabilities. Knowing this boundary - what belongs in core, what belongs in an extension,
and what belongs in your own product - is senior judgement.

---

## 1. The extensions framework

- `ClientCapabilities` and `ServerCapabilities` both carry an `extensions` field. Support
  is **negotiated**, never assumed.
- Extensions may define new `_meta` keys (official ones under `io.modelcontextprotocol/`,
  third-party under your own vendor prefix) and new `resultType` values - but a client may
  only accept `resultType` values from the core plus extensions it advertised.
- Read: [Extensions overview](https://modelcontextprotocol.io/extensions/overview) and the
  [client support matrix](https://modelcontextprotocol.io/extensions/client-matrix). The
  matrix is the difference between "spec-supported" and "actually usable today".

Design rule: **prefer core, then official extension, then plain tool arguments.** Inventing
a private extension is the last resort, because every client that does not know it sees a
broken server.

---

## 2. Tasks extension (`io.modelcontextprotocol/tasks`)

Long jobs used to be an experimental core feature; they are now an official extension, and
the design changed:

- Polling with `tasks/get` replaced the blocking `tasks/result`.
- New `tasks/update` carries client-to-server input during a running task.
- `tasks/list` was removed.
- Servers **may return task handles unsolicited** - no per-request opt-in.

Read [Tasks](https://modelcontextprotocol.io/extensions/tasks/overview) and the
[2026-07-28 changelog entry](https://modelcontextprotocol.io/specification/2026-07-28/changelog).

When to reach for Tasks instead of a plain streaming call:

| Situation | Use |
| --- | --- |
| < ~30 s, client can wait | Normal `tools/call`, stream progress |
| Minutes to hours, survives disconnects | Tasks extension |
| Needs input mid-flight | Tasks (`tasks/update`) or MRTR, depending on who initiates |
| Client does not support the extension | Fall back to a server-minted `job_id` handle plus a `get_job_status` tool |

That fallback is worth internalising: a handle-plus-status-tool design works on **any**
client, which is why it is the pragmatic default for internal platforms today.

---

## 3. MCP Apps

Interactive UI rendered inside a host (Claude Desktop and others). A tool result can bring
a small application, not just text.

- [MCP Apps overview](https://modelcontextprotocol.io/extensions/apps/overview)
- [Build an MCP App](https://modelcontextprotocol.io/extensions/apps/build)

Why it matters: many agent tasks are not conversational. Choosing a row, approving a diff,
picking a date, watching a job - all are better as UI. Apps are also where the security
questions get spicy: untrusted content rendering, origin isolation, and what the app may
ask the host to do. Treat an app bundle with the same suspicion as a browser extension.

---

## 4. Authorization extensions

Core auth assumes a human at a browser. Real deployments need more:

| Extension | Use case |
| --- | --- |
| [OAuth client credentials](https://modelcontextprotocol.io/extensions/auth/oauth-client-credentials) | Machine-to-machine: CI jobs, batch agents, service-to-service MCP calls with no user present |
| [Enterprise-managed authorization](https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization) | Centralised control via the company IdP: which servers, which users, which scopes |

If you work anywhere with a security review, enterprise-managed authorization is the
feature that gets MCP approved. Learn it before you need it.

---

## 5. Reading the frontier

Skills that keep you ahead rather than catching up:

1. **Track `draft`.** [draft changelog](https://modelcontextprotocol.io/specification/draft/changelog)
   shows what lands next. Reading it monthly costs 15 minutes.
2. **Read SEPs.** [SEP index](https://modelcontextprotocol.io/seps/index). Each SEP has the
   problem statement, alternatives, and rationale - the highest-density protocol-design
   material available anywhere.
3. **Watch the deprecation registry.**
   [Deprecated features](https://modelcontextprotocol.io/specification/2026-07-28/deprecated)
   plus the 12-month window tells you what to stop building on today: Roots, Sampling,
   Logging, HTTP+SSE, DCR.
4. **Read the schema, not the prose.**
   [`schema.ts`](https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts)
   is the source of truth; the JSON Schema is generated from it.

---

## 6. When to invent your own extension

Ask, in order:

1. Can plain tool arguments and a server-minted handle do this? Then do that.
2. Does an official extension cover it? Use it, even if imperfect.
3. Is the need general? Then write a SEP instead of a private extension
   ([L8](./08-mastery-and-influence.md)).
4. Truly product-specific? Then: vendor `_meta` prefix (second label **not**
   `modelcontextprotocol`/`mcp`), advertise it in `extensions` capabilities, degrade
   gracefully when absent, and document it publicly.

An extension that breaks unaware clients is a bug, not a feature.

---

## Drills

1. **Tasks both ways (4 h).** Implement a 5-minute job twice: once with the Tasks
   extension, once with a `job_id` handle plus status tool. Compare code size, client
   compatibility, and failure behaviour on disconnect.
2. **Capability gating (60 min).** Advertise an extension. From a client that does not
   declare it, confirm your server degrades instead of failing.
3. **Build an App (4-6 h).** One tool that returns an interactive panel: a table with a
   selectable row that feeds the next tool call.
4. **App threat model (60 min).** List what your app renders, where that content comes
   from, and what it can ask the host to do. Then close the worst hole.
5. **M2M auth (3 h).** Add client-credentials auth for a CI job that calls your server with
   no user present, with its own scopes and quota.
6. **SEP dissection (90 min).** Read SEP-2322 (MRTR), SEP-2575 (stateless core) and
   SEP-2567 (session removal). Write one page: problem, alternatives, why this design won.

---

## Gotchas

- Using an extension without negotiating it.
- Accepting a `resultType` from an extension you never advertised.
- Choosing Tasks when the client does not support it and offering no fallback.
- Reserved `_meta` prefixes: `io.modelcontextprotocol/`, `dev.mcp/`, `com.mcp.*` are not
  yours. `com.yourco.mcp/` is fine.
- Building today on Sampling, Roots, Logging, HTTP+SSE, or DCR.
- Treating MCP App content as trusted.

---

## Exit test

1. Explain the extensions negotiation mechanism and the `_meta` prefix rules.
2. Ship one long job through Tasks and one through a handle, and argue when each is right.
3. Ship one MCP App and present its threat model.
4. Explain client-credentials versus enterprise-managed authorization in one paragraph each.
5. Summarise the three SEPs above from memory.

Projects: [`M03`](../projects/after-l7-frontier.md#m03--long-jobs-with-the-tasks-extension),
[`M04`](../projects/after-l7-frontier.md#m04--mcp-app-ui).

Next: [L8 - Mastery and influence](./08-mastery-and-influence.md).
