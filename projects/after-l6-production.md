# Build after L6 - Production and scale

Concepts required: [L6 Production and scale](../roadmap/06-production-and-scale.md).

---

### M06 — Production Hardening Pack

- **Size:** `[M]` one to two weeks
- **Unlocked after:** L6
- **Concepts:** SLOs, load testing, tracing, quotas, multi-tenancy, release engineering,
  registry publishing

**Goal.** Take servers you already built (M01 and M02) and make them genuinely operable -
the step almost nobody does, and the step that makes you the person trusted with the
production system.

**Requirements**

1. **SLOs written down.** p95 `tools/call` latency, availability, and tool error rate, per
   server. In the README, with the reasoning.
2. **Load test.** Concurrent callers plus concurrent SSE streams. Find the knee of the
   curve. Publish numbers and the graph. State the breaking resource (CPU, DB pool, file
   descriptors).
3. **Tracing.** Accept `traceparent`/`tracestate`/`baggage` from `_meta`, propagate into
   every downstream call, and export to any OTel backend. One screenshot of a single trace
   spanning host -> server -> database.
4. **Metrics.** Per-method and per-tool latency, `isError` rate versus JSON-RPC error rate,
   `tools/list` bytes, cancellation rate, MRTR rounds per completed call, per-principal call
   rate, result-size distribution.
5. **Quotas.** Per-principal rate limits and concurrency caps, derived from token claims -
   never from a tool argument. Limit breaches return a clear, model-readable error.
6. **Multi-tenancy proof.** Two tenants, one deployment: a test proves tenant A cannot read
   tenant B's data through any tool, resource, or cached list.
7. **Redaction.** Logs contain no tokens, no `requestState`, no secret arguments. Prove it
   with a log scan test.
8. **Release engineering.** Semantic version for the server, documented list of protocol
   revisions served, CI gates (unit + [S10 conformance](./after-l5-security.md#s10--server-smoke-suite)
   + tool-selection eval), and a canary/rollback procedure you have actually executed once.
9. **Published.** Server listed in the MCP Registry with automated publishing, plus a
   deprecation policy for your own tools modelled on the spec's 12-month window.

**Acceptance**

- A one-page runbook: dashboards, alerts, top three failure modes, rollback steps.
- A recorded canary drill: ship a deliberately bad tool description to one replica, detect
  it from metrics, roll back, write the 5-line incident note.
- Quota storm test: one principal calling 100x/s is contained, with no downstream damage.
- Registry entry live, install/connect instructions verified from a clean machine.

**Stretch.** Add a cost model: cents per 1000 calls and tokens per turn attributable to
this server, then cut one of them by 30% and show what you changed.

**Mastery marker.** You can answer "what happens at 10x traffic" with measurements instead
of opinions.
