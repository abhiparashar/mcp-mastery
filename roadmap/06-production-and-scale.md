# L6 - Production and Scale

**Time:** 2.5 weeks. **Goal:** operate MCP servers like real services, with numbers you
can defend in a review.

Statelessness was the gift of 2026-07-28: an MCP server is now an ordinary stateless HTTP
service. Everything you already know about running services applies - and this level is
about applying it deliberately, not accidentally.

---

## 1. Deployment topologies

| Topology | When | Watch out for |
| --- | --- | --- |
| stdio, local subprocess | Dev tools, file access, personal agents | Arbitrary code with user rights; version pinning; no OAuth |
| Single remote server | One team, one API | Cold starts on SSE; proxy buffering |
| Server per domain + gateway | Many teams | Tool-name collisions, aggregate token budget |
| Sidecar per tenant | Hard isolation needs | Cost, cold start, ops surface |
| Serverless (functions) | Bursty, short calls | Long SSE streams and per-request timeouts fight each other |

Because there are no sessions, **any replica can serve any request**. That means plain
round-robin load balancing, no sticky routing, and no shared session store. State that
must survive across calls goes in one of exactly two places:

1. a **server-minted handle** passed back as an ordinary tool argument (e.g. `job_id`,
   `cursor_token`), or
2. the opaque, integrity-protected **`requestState`** in an MRTR flow.

If you find yourself wanting a session, you actually want a handle.

---

## 2. Caching as a first-class feature

You already must send `ttlMs` and `cacheScope` (see
[L2](./02-server-primitives.md#6-caching-ttlms-cachescope---new-and-mandatory)). Now use
them as an engineering lever:

- Long TTL + `public` on stable `tools/list`, `prompts/list`,
  `resources/templates/list`. This is what makes gateway caching and LLM prompt caching
  work.
- Short TTL + `private` on user-scoped `resources/read`.
- `listChanged` notifications as immediate invalidation, TTL as the backstop for clients
  that never opened a `subscriptions/listen` stream. Never assume a listener exists.
- Deterministic tool ordering. Byte-stable list payloads mean prompt-cache hits, which is
  real money at scale.
- Because the standard headers (`Mcp-Method`, `Mcp-Name`, `Mcp-Param-*`) are on the
  request, an edge cache or WAF can make decisions without parsing bodies. Design your
  header usage with that in mind.

---

## 3. Observability

- **Traces.** `_meta` carries `traceparent`, `tracestate`, `baggage` per W3C Trace
  Context, and OpenTelemetry publishes
  [semantic conventions for MCP](https://opentelemetry.io/docs/specs/semconv/gen-ai/mcp/).
  Propagate them into every downstream call, so one trace shows host -> server -> database.
- **Logs.** The Logging feature is deprecated. On stdio, log to stderr. Remotely, log
  structurally to your platform. `notifications/message` only for requests that set
  `io.modelcontextprotocol/logLevel`, never otherwise.
- **Metrics that matter for MCP**, not generic RPS dashboards:

| Metric | Why |
| --- | --- |
| p50/p95/p99 per method **and per tool name** | One slow tool poisons whole agent turns |
| Tool error rate split into `isError` vs JSON-RPC error | Business failure vs protocol failure are different bugs |
| `tools/list` payload bytes and token estimate | Guards the context budget |
| Cache hit ratio (client-reported or gateway) | Validates your `ttlMs` choices |
| Cancellation rate and post-cancel work | Detects abandoned-work waste |
| MRTR rounds per completed call | More than ~2 means a bad tool design |
| Per-principal call rate | Abuse and runaway-agent detection |
| Result size distribution | Context blowouts before customers find them |

- **Redaction.** Never log tokens, `requestState`, or raw arguments that can hold secrets.

---

## 4. Limits, quotas, multi-tenancy

- Rate-limit **per principal**, not per IP. Agents retry hard, and one buggy loop can look
  like an attack.
- Bound everything: result bytes, rows returned, execution time, concurrent SSE streams
  per principal, and total in-flight work.
- Derive tenancy from **token claims**, never from a tool argument. A `tenant_id`
  parameter is a privilege-escalation invitation.
- Filter the surface by authorization: `tools/list` **MAY** vary by the credential
  presented, and that is the sanctioned way to hide privileged tools. It must not vary by
  connection.
- Idempotency keys on write tools. Models retry; your database should not care.
- Budget guards: max MRTR rounds, max progress notifications, max stream lifetime.

---

## 5. Testing strategy

Four layers, each catching something the others cannot:

1. **Unit** - tool handlers as plain functions. Fast, boring, high coverage.
2. **Protocol conformance** - assert the wire rules: required `_meta` handling, `resultType`
   presence, cache hints on the six cacheable operations, error codes and HTTP statuses,
   header mismatch behaviour, deterministic tool ordering. Drive it with the Inspector CLI
   (documented output formats and exit codes) plus your own probes. See
   [`S10`](../projects/after-l5-security.md#s10--server-smoke-suite).
3. **Integration** - real transport, real proxy, real auth: token audience rejection,
   cancellation, SSE keep-alive through a 30 s idle timeout.
4. **Evaluations** - does a model actually use the server correctly? Fixed set of user
   requests, expected tool choice, scored automatically. Gate merges on it. Tool-selection
   accuracy is a **regression-testable** property; treating it as one is a top-1% habit.

Run the matrix per protocol era you claim to support (see
[`reference/protocol-eras.md`](../reference/protocol-eras.md)).

---

## 6. Release engineering

- **Semantic versioning of your server**, separate from the protocol revisions it speaks.
  State both in your README.
- **Deprecation policy.** The spec itself now uses Active / Deprecated / Removed with a
  minimum 12-month window
  ([feature lifecycle](https://modelcontextprotocol.io/community/feature-lifecycle)).
  Copy that discipline for your own tools: announce, keep working, then remove.
- **Publish to the MCP Registry** so clients can discover you:
  [about](https://modelcontextprotocol.io/registry/about),
  [quickstart](https://modelcontextprotocol.io/registry/quickstart),
  [package types](https://modelcontextprotocol.io/registry/package-types),
  [remote servers](https://modelcontextprotocol.io/registry/remote-servers),
  [versioning](https://modelcontextprotocol.io/registry/versioning),
  [GitHub Actions automation](https://modelcontextprotocol.io/registry/github-actions).
- **CI gates:** lint, unit, conformance, eval score, and a check that your published
  `supportedVersions` matches what your tests exercise.
- **Rollout:** canary one replica, watch tool error rate and p95, then ramp. Because lists
  are cached by clients with your own `ttlMs`, a bad tool-list deploy can stick around for
  the TTL you chose - keep list TTLs modest during rapid iteration.

---

## 7. Cost and latency engineering

Three budgets, written down, per server:

| Budget | Example target | Lever |
| --- | --- | --- |
| Tokens per turn from this server | <= 2000 for `tools/list` + typical result | Fewer tools, tighter descriptions, `resource_link` instead of inline payloads |
| Latency | p95 `tools/call` < 800 ms, first progress event < 500 ms | Caching, connection pooling, streaming early |
| Cost | cents per 1000 calls | Downstream call reduction, result caching, cheaper models for internal sampling replacement |

If you cannot state these three numbers for a server you own, you are not operating it yet.

---

## Drills

1. **SLO and load test (3 h).** Define p95 and error-rate SLOs. Load-test with concurrent
   SSE streams. Find the breaking point; publish the graph in your README.
2. **Trace end to end (2 h).** Propagate `traceparent` from a host through your server into
   a database call. Screenshot the single trace.
3. **Quota storm (90 min).** Simulate a runaway agent calling one tool 100x/s. Show
   per-principal limiting, a clear error the model can act on, and no downstream damage.
4. **Cache experiment (2 h).** Measure tokens and latency per turn with `ttlMs: 0` versus a
   real TTL and deterministic ordering. Report the delta.
5. **Canary drill (90 min).** Ship a deliberately broken tool description to one replica.
   Detect it with your metrics, roll back, and write the 5-line incident note.
6. **Publish (2 h).** Put a real server in the MCP registry with CI-based publishing and a
   versioning policy in the README.

---

## Gotchas

- Assuming sticky routing still exists. It does not; state must be explicit.
- Long-lived SSE streams on serverless with short request timeouts.
- Trusting a `tenant_id` argument instead of token claims.
- Rate limiting by IP while agents share egress.
- Huge `ttlMs` during active development; clients will hold stale tool lists.
- Logging arguments wholesale, capturing secrets.
- No cancellation propagation, so cancelled work keeps burning quota.
- Only testing the current revision while advertising support for older ones.

---

## Exit test

1. State your server's SLOs, and show the load test that validates them.
2. Show one trace crossing host, server and downstream dependency.
3. Show per-principal quotas firing with a model-readable error.
4. Show the conformance suite and eval score running in CI.
5. Your server is published, versioned, and documents which protocol revisions it serves.

Projects: [`M01`](../projects/after-l2-primitives.md#m01--read-only-db-gateway),
[`S10`](../projects/after-l5-security.md#s10--server-smoke-suite),
[`L01`](../projects/capstones.md#l01--contextos).

Next: [L7 - Extensions and frontier](./07-extensions-and-frontier.md).
