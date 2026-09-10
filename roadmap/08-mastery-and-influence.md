# L8 - Mastery and Influence

**Time:** ongoing. **Goal:** stop being a consumer of the protocol and become one of the
people who shapes it.

Levels 0-7 make you excellent. This level makes you *visible* as excellent, which is the
working definition of top 1%: other engineers' code changes because of your work.

---

## 1. Schema fluency

Read the source of truth end to end, once, with a notebook open:

- [`schema/2026-07-28/schema.ts`](https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.ts)
- The generated [JSON Schema](https://github.com/modelcontextprotocol/specification/blob/main/schema/2026-07-28/schema.json)
- The rendered [Schema Reference](https://modelcontextprotocol.io/specification/2026-07-28/schema)

Deliverable: a one-page map of every request, result, notification and error type, marking
which are cacheable, which may return `input_required`, and which are extension-only. With
that page in your head, spec questions become instant.

Bonus signal: the JSON Schema is *generated*, and a real generator bug shipped once
(`minimum`/`maximum`/`default` typed as integer instead of number, fixed in 2026-07-28).
People who read generated artifacts find bugs reviewers miss.

---

## 2. Build a conformance suite

The strongest single artifact you can own: a suite that points at **any** MCP server and
grades it against 2026-07-28.

| Area | Assertions |
| --- | --- |
| Discovery | `server/discover` implemented; `supportedVersions` non-empty; cache hints present |
| `_meta` | Missing `protocolVersion` -> `-32602` + HTTP 400; missing declared capability -> `-32021` with `data.requiredCapabilities` |
| Versions | Unknown version -> `-32022` listing supported versions; header/body mismatch -> `-32020` + 400 |
| Results | Every result carries `resultType`; unknown method -> 404 + `-32601` |
| Caching | `ttlMs >= 0` and `cacheScope` on all six cacheable operations; one `cacheScope` across all pages |
| Tools | Deterministic ordering; `inputSchema` is an object schema; names match the charset rule; `structuredContent` validates against `outputSchema` |
| Invariance | `tools/list` identical across two fresh connections with the same credential |
| Streaming | Progress only with `progressToken`; final response closes the stream; keep-alive comments on `subscriptions/listen` |
| Cancellation | Work stops after stream close; nothing further sent for that id |
| Security | Wrong-audience token -> 401; bad `Origin` -> 403; no secrets in `x-mcp-header` params |
| MRTR | `input_required` only on the three allowed methods; retry with a new id succeeds; tampered `requestState` rejected |

Publish it, run it against popular public servers, file the failures as issues. That single
activity has produced more protocol contributors than any tutorial.
Spec: [`S10`](../projects/after-l5-security.md#s10--server-smoke-suite).

---

## 3. Review other people's servers with a rubric

Rubric: [`reference/drills.md`](../reference/drills.md#review-rubric). Do ten reviews. You
will start spotting these in seconds:

- endpoint-shaped tools instead of task-shaped
- descriptions written for humans, not models
- unbounded results
- business errors returned as JSON-RPC errors
- missing cache hints
- token passthrough
- no cancellation propagation

---

## 4. Contribute upstream

Escalating ladder - in order:

1. **Docs fix.** A wrong or unclear sentence. Small, real, merged.
2. **SDK issue with a minimal reproduction.** Frame capture plus 20 lines.
3. **SDK pull request.** Behaviour that violates the spec, with a test.
4. **Spec issue.** An ambiguity found while writing your conformance suite. Ambiguity
   reports are gold to spec editors.
5. **SEP.** Markdown in the `seps/` directory, PR-derived numbering, a sponsor, status
   tracked by PR labels.

Read before you write:

- [SEP index](https://modelcontextprotocol.io/seps/index) - read five in full
- [Governance (SEP-932)](https://modelcontextprotocol.io/seps/932-model-context-protocol-governance)
- [Working and interest groups (SEP-1302)](https://modelcontextprotocol.io/seps/1302-formalize-working-groups-and-interest-groups-in-mc)
- [Feature lifecycle policy](https://modelcontextprotocol.io/community/feature-lifecycle)
- [Spec repo](https://github.com/modelcontextprotocol/modelcontextprotocol) and
  [discussions](https://github.com/modelcontextprotocol/specification/discussions)

An accepted SEP has: a narrow problem, evidence it hurts real implementations, at least two
alternatives honestly compared, a migration story, and minimal new surface. Read SEP-2322
(MRTR) and SEP-2575 (stateless core) as templates - both are breaking changes argued well
enough to ship.

---

## 5. Teach in public

- Write the article that did not exist when you were learning. "What actually changed in
  MCP 2026-07-28 and how to migrate a 2025-06-18 server" is genuinely missing today.
- Give the 30-minute internal talk: protocol, removals, security failure modes, your numbers.
- Own the internal standard: a one-page "how we build MCP servers here", adopted by other
  teams. That artifact is exactly what promotion committees read.
- Publish one reference server that demonstrates the whole checklist. Not a toy.

---

## 6. Keep the edge

| Cadence | Activity |
| --- | --- |
| Weekly | One SEP or spec section; skim the `draft` changelog |
| Weekly | Read one public server's source; note one good and one bad decision |
| Monthly | Re-run your conformance suite against your servers and two public ones |
| Monthly | Re-score tool-selection accuracy on your main server |
| Per SDK release | Read the changelog; encode behaviour changes as tests |
| Per protocol revision | Write your own migration note before anyone asks |

---

## Exit test (a portfolio, not a quiz)

1. A published conformance suite, with findings filed against at least two public servers.
2. Ten written server reviews using your rubric.
3. One merged upstream contribution (docs, SDK, or spec).
4. One authored SEP, or a written proposal with a sponsor conversation started.
5. One public article and one talk.
6. A reference server of your own that passes your own suite with no exceptions.

Projects: [`L02 Protocol From Scratch`](../projects/capstones.md#l02--protocol-from-scratch),
[`L05 Upstream Impact`](../projects/capstones.md#l05--upstream-impact).

Back to [ROADMAP.md](../ROADMAP.md).
