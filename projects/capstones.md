# Capstones

Large projects `[L]`, three to six weeks each. Each one states the level it needs. **Never
run two at once.** These are the artifacts you show people, and the reason you will be
believed.

| ID | Name | Needs | Best for proving |
| --- | --- | --- | --- |
| L01 | ContextOS | L6 | Platform and operations judgement |
| L02 | Protocol From Scratch | L4 | Deep protocol authority |
| L03 | AgentBench | L4 (better after L6) | Measurement and host design |
| L04 | SecureMCP | L5 | Security credibility |
| L05 | Upstream Impact | L8 | Influence in the ecosystem |

Recommended: pick **L02 or L04 first** (they build authority fastest), then L01 or L03 as a
platform showcase, then L05 as a continuous track.

---

### L01 — ContextOS

- **Needs:** [L6](../roadmap/06-production-and-scale.md)
- **Time:** 4-6 weeks

**Goal.** A multi-tenant internal MCP platform: several domain servers behind one
authenticated gateway, with the operational surface a real company requires.

**Requirements**

1. Three domain servers (for example code search, tickets, analytics), each with a
   task-shaped tool surface and resource schemes.
2. Gateway from [M05](./after-l4-clients.md#m05--mcp-gatewayrouter) as the single entry
   point: namespacing, policy, budgets, credential exchange per upstream.
3. Auth from [M02](./after-l5-security.md#m02--oauth-protected-remote-server): OAuth 2.1,
   audience-bound tokens, scope-driven tool visibility, enterprise-managed authorization
   path documented.
4. Tenancy from token claims only; a test proving cross-tenant isolation through tools,
   resources, and caches.
5. Operations: SLOs, dashboards, alerts, per-principal quotas, OTel traces end to end,
   structured logs with redaction.
6. Delivery: CI with unit + conformance ([S10](./after-l5-security.md#s10--server-smoke-suite))
   + eval gates, canary deploys, documented rollback, semantic versioning, registry
   publication for the public parts.
7. Governance docs: onboarding guide for a new server owner, tool-design standard, review
   checklist.
8. A capacity model: requests/sec per replica, cost per 1000 calls, and the 10x plan.

**Acceptance**

- A new domain server can be onboarded by someone else, following your docs, in under a day.
- Load test to the stated SLO, published graph, named bottleneck.
- One executed game day: kill an upstream, exhaust a quota, expire a token; runbook holds.
- One-page architecture doc that a staff engineer can review in ten minutes.

**Mastery marker.** Someone else operates it successfully using only your documentation.

---

### L02 — Protocol From Scratch

- **Needs:** [L4](../roadmap/04-clients-and-hosts.md)
- **Time:** 3-5 weeks

**Goal.** Write your own MCP implementation - server **and** client - in two languages,
with no official SDK, and make it pass your own conformance suite.

**Requirements**

1. TypeScript and Python (or Go/Rust if you prefer), sharing one test corpus of recorded
   frames.
2. Full core coverage: `server/discover`, tools, resources (with templates), prompts,
   pagination, completion, caching hints, progress, cancellation, `subscriptions/listen`,
   MRTR including signed `requestState`.
3. Both transports: stdio (newline framing, stderr logging) and Streamable HTTP (POST-only,
   required headers, correct status codes, SSE responses, keep-alives).
4. Two protocol eras served by one codebase: 2026-07-28 plus at least one of 2025-11-25 /
   2025-06-18, including `initialize`-era fallback on stdio and the absent-`resultType`
   rule. Era logic lives in one adapter layer.
5. Strictness: reject malformed `_meta`, unknown `resultType`, `$ref` network
   dereferencing, oversized/deeply nested schemas.
6. Passes [S10](./after-l5-security.md#s10--server-smoke-suite) with zero exceptions, plus
   interoperability tests against the official SDKs in both directions (your client ->
   their server, their client -> your server).
7. Published as a library with a README that honestly states what is not implemented.

**Acceptance**

- Interop matrix in the README: your client/server against both official SDKs, both
  transports, both eras - all green.
- A written list of at least five spec ambiguities or SDK behaviour differences you found.
  This is the artifact that leads to upstream contributions.

**Mastery marker.** You found and reported something real in the spec or an SDK while
building it.

---

### L03 — AgentBench

- **Needs:** [L4](../roadmap/04-clients-and-hosts.md), better after
  [L6](../roadmap/06-production-and-scale.md)
- **Time:** 3-4 weeks

**Goal.** A host application plus evaluation harness that measures whether MCP servers make
an agent *better*, with numbers.

**Requirements**

1. A real host loop: connect N servers, merge and namespace tools, cache lists by
   `ttlMs`/`cacheScope`, enforce per-turn budgets (tool calls, result bytes, wall clock),
   handle MRTR, keep a human-in-the-loop confirmation path.
2. A task corpus: at least 50 realistic user requests across your servers, with expected
   tool choice and expected outcome.
3. Metrics: tool-selection accuracy, task success rate, tokens per task, latency per task,
   cost per task, wrong-tool confusion matrix.
4. Ablations that answer real design questions: full tool list versus filtered; verbose
   versus terse descriptions; `structuredContent` versus text; one big tool versus three
   small ones.
5. Regression gating: a CI job that fails when accuracy or cost regresses beyond a
   threshold.
6. A written report with graphs and recommendations that a team could act on.

**Acceptance**

- Report shows at least three findings with numbers, including one that contradicts a
  common belief (for example "more tools helped" or "descriptions mattered more than
  schemas").
- Re-running the benchmark is one command and is deterministic apart from model sampling.

**Mastery marker.** Your recommendations change how your team designs tools.

---

### L04 — SecureMCP

- **Needs:** [L5](../roadmap/05-auth-and-security.md)
- **Time:** 3-4 weeks

**Goal.** A red-team suite plus scanner for MCP servers, with mitigations proven on a
deliberately vulnerable server you also write.

**Requirements**

1. **Vulnerable server** (clearly labelled, never deployed publicly): token passthrough,
   no audience validation, proxy without per-client consent, wildcard `redirect_uri`,
   injectable resource content, unbounded results, secrets in `x-mcp-header`, unsigned
   `requestState`, no `Origin` validation.
2. **Attack suite**, one runnable exploit each: wrong-audience token accepted; confused
   deputy code theft; `iss` spoofing; `requestState` tamper and cross-principal replay;
   prompt injection through a resource and through a tool description; schema DoS via deep
   composition and network `$ref`; result-size context flood; rug-pull tool redefinition.
3. **Hardened server**: same features, every attack blocked, with the specific control named
   per attack.
4. **Scanner**: a tool that probes any MCP server for the *safe-to-test* subset (audience
   handling, `Origin`, PRM correctness, schema bounds, header hygiene, cache-scope
   sanity) and emits a graded report. Non-destructive by default, with an explicit
   `--aggressive` flag for servers you own.
5. **Write-up** in real security-report format: finding, severity, evidence, reproduction,
   fix, verification.
6. Responsible-use notice and an ethics section: only against servers you own or have
   written permission to test.

**Acceptance**

- Every attack demonstrably succeeds on the vulnerable server and fails on the hardened one,
  in one command.
- Scanner run against your own deployed servers, with findings fixed and re-verified.
- Report readable by a security engineer with no MCP background.

**Mastery marker.** Someone else uses your scanner on their server and fixes something.

---

### L05 — Upstream Impact

- **Needs:** [L8](../roadmap/08-mastery-and-influence.md)
- **Time:** continuous

**Goal.** Change the ecosystem, not just your repo.

**Requirements**

1. Publish your conformance suite ([S10](./after-l5-security.md#s10--server-smoke-suite))
   and run it against at least five public servers. File clear, reproducible issues.
2. Ten public server reviews using your rubric
   ([`reference/drills.md`](../reference/drills.md#review-rubric)).
3. Ladder of contributions, in order: docs fix -> SDK issue with minimal reproduction ->
   SDK pull request with a test -> spec ambiguity issue -> authored SEP.
4. One article: the migration guide from a 2025-era server to 2026-07-28, written from your
   own migration, with frames before and after.
5. One talk (internal counts) with slides published.
6. A reference server of your own that passes your suite with zero exceptions and is listed
   in the registry.

**Acceptance**

- At least one merged upstream contribution.
- A SEP authored, or a written proposal with a sponsor conversation started.
- Evidence someone else adopted something you wrote: an issue, a PR, a citation, a fork.

**Mastery marker.** You are cited by someone you have never met.
