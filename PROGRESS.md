# Progress tracker

One checkbox per skill. Rule: a level is done only when its **exit test** passes with no
notes and no help. Date each completion - the dates are the evidence of momentum.

Started: `____-__-__`

---

## L0 - Prerequisites

- [ ] Wrote JSON-RPC request / result / error / notification by hand
- [ ] Wrote a JSON Schema 2020-12 with enum, bounds, required, `additionalProperties: false`
- [ ] Can name the four reused JSON-RPC error codes and their MCP meaning
- [ ] Explained the tool / resource / prompt ownership split out loud
- [ ] Dev environment ready (Node 20+ or Python 3.10+, Inspector installed)
- [ ] Read raw frames in the Inspector against a published server
- [ ] **Exit test passed** on `____-__-__`

## L1 - Protocol core

- [ ] Hand-rolled stdio server: `server/discover`, `tools/list`, `tools/call`, no SDK
- [ ] Correct `-32602` for missing required `_meta`
- [ ] Correct `-32021` with `data.requiredCapabilities`
- [ ] Correct `-32022` listing supported versions
- [ ] Every result carries `resultType`; client treats absent as `complete`
- [ ] Can explain why sessions and `initialize` were removed
- [ ] Translated a 2025-era `initialize` exchange into 2026-07-28 traffic
- [ ] Projects: [S04](./projects/after-l1-foundations.md#s04--bare-metal-json-rpc),
      [S06](./projects/after-l1-foundations.md#s06--tiny-client-cli)
- [ ] **Exit test passed** on `____-__-__`

## L2 - Server primitives

- [ ] Three-tool server with schemas, `outputSchema`, `isError` semantics
- [ ] Deterministic, byte-identical `tools/list` across calls
- [ ] Cache hints on all six required operations, correct `cacheScope` choices
- [ ] Resources with templates, pagination, and `completion/complete`
- [ ] Three prompts that beat free-typing, with transcripts
- [ ] Cut a 20-endpoint API to <= 6 tools with written rationale
- [ ] Tool-selection accuracy measured: before `____%` -> after `____%`
- [ ] `tools/list` token budget: `_____` tokens (target stated in README)
- [ ] Projects: [S01](./projects/after-l2-primitives.md#s01--hello-tools),
      [S02](./projects/after-l2-primitives.md#s02--notes-resources),
      [S03](./projects/after-l2-primitives.md#s03--prompt-pack),
      [M01](./projects/after-l2-primitives.md#m01--read-only-db-gateway)
- [ ] **Exit test passed** on `____-__-__`

## L3 - Transports

- [ ] Same handlers running under stdio and Streamable HTTP
- [ ] All required headers implemented; every wrong-header case asserted by tests
- [ ] Correct statuses: `404`/`-32601`, `400`/`-32022`, `400`/`-32020`, `403` bad Origin, `202` notification
- [ ] Progress only with `progressToken`, human-readable messages
- [ ] Cancellation stops real downstream work in both transports
- [ ] `subscriptions/listen` with opt-in types, `subscriptionId`, keep-alives
- [ ] Survived a 30 s proxy idle timeout on a quiet stream
- [ ] Projects: [S05](./projects/after-l3-transports.md#s05--streamable-http-deploy),
      [S07](./projects/after-l3-transports.md#s07--progress-and-cancel),
      [S08](./projects/after-l3-transports.md#s08--subscriptions-watcher)
- [ ] **Exit test passed** on `____-__-__`

## L4 - Clients and hosts

- [ ] Wrote a client from scratch (no SDK) that honours cache hints and version fallback
- [ ] MRTR implemented on both sides, retry with a new id
- [ ] `requestState` signed; tamper, cross-principal, expired and cross-request replays all rejected
- [ ] Host budgets enforced: max tool calls, max result bytes, wall clock
- [ ] One client works against two protocol eras, era logic in a single adapter
- [ ] Namespacing and collision policy implemented
- [ ] Projects: [S09](./projects/after-l4-clients.md#s09--mrtr-elicitation),
      [M05](./projects/after-l4-clients.md#m05--mcp-gatewayrouter)
- [ ] **Exit test passed** on `____-__-__`

## L5 - Auth and security

- [ ] PRM published; `401` carries `resource_metadata` and `scope`
- [ ] Audience validation enforced and unit-tested
- [ ] `resource` parameter sent on authorize and token requests
- [ ] All four `iss` validation cases implemented and tested
- [ ] CIMD registration working; DCR only as documented fallback
- [ ] Scope-driven tool visibility and enforcement; step-up flow works
- [ ] Confused deputy reproduced, then blocked (write-up saved)
- [ ] Injection lab: resource-borne instruction had no effect
- [ ] Threat-model table filled for every tool and resource
- [ ] Projects: [M02](./projects/after-l5-security.md#m02--oauth-protected-remote-server),
      [S10](./projects/after-l5-security.md#s10--server-smoke-suite)
- [ ] **Exit test passed** on `____-__-__`

## L6 - Production and scale

- [ ] SLOs written: p95 `_____` ms, availability `_____`, tool error rate `_____`
- [ ] Load test run; knee of the curve at `_____` rps; bottleneck: `__________`
- [ ] End-to-end trace across host -> server -> dependency
- [ ] MCP-specific metrics dashboard (per-tool latency, `isError` rate, list size, MRTR rounds)
- [ ] Per-principal quotas with model-readable errors
- [ ] Cross-tenant isolation test passes
- [ ] Log redaction test passes
- [ ] CI gates: unit + conformance + eval; canary and rollback executed once
- [ ] Published to the MCP Registry with versioning and deprecation policy
- [ ] Projects: [M06](./projects/after-l6-production.md#m06--production-hardening-pack)
- [ ] **Exit test passed** on `____-__-__`

## L7 - Extensions and frontier

- [ ] Extension negotiation implemented and gated on capabilities
- [ ] Long job shipped twice: Tasks extension and server-minted handle fallback
- [ ] Job survives client disconnect and server restart
- [ ] One MCP App shipped, with graceful degradation on unsupported hosts
- [ ] App threat model written and worst hole closed
- [ ] Machine-to-machine auth (client credentials) working with its own quota
- [ ] Read and summarised SEP-2322, SEP-2575, SEP-2567
- [ ] Projects: [M03](./projects/after-l7-frontier.md#m03--long-jobs-with-the-tasks-extension),
      [M04](./projects/after-l7-frontier.md#m04--mcp-app-ui)
- [ ] **Exit test passed** on `____-__-__`

## L8 - Mastery and influence

- [ ] Read `schema.ts` end to end; one-page type map written
- [ ] Conformance suite published
- [ ] Suite run against >= 5 public servers; issues filed
- [ ] Ten server reviews written with the rubric
- [ ] Docs fix merged
- [ ] SDK issue filed with minimal reproduction
- [ ] SDK pull request merged
- [ ] Spec ambiguity issue filed
- [ ] SEP authored (or proposal + sponsor conversation started)
- [ ] Migration article published
- [ ] Talk delivered
- [ ] Reference server published, passing your own suite with zero exceptions
- [ ] Capstone shipped: `___________________`

---

## Capstones

- [ ] [L01 ContextOS](./projects/capstones.md#l01--contextos) - `____-__-__`
- [ ] [L02 Protocol From Scratch](./projects/capstones.md#l02--protocol-from-scratch) - `____-__-__`
- [ ] [L03 AgentBench](./projects/capstones.md#l03--agentbench) - `____-__-__`
- [ ] [L04 SecureMCP](./projects/capstones.md#l04--securemcp) - `____-__-__`
- [ ] [L05 Upstream Impact](./projects/capstones.md#l05--upstream-impact) - ongoing

## Skills matrix scores (0-5, re-score monthly)

| Skill | M1 | M2 | M3 | M4 | M5 | M6 |
| --- | --- | --- | --- | --- | --- | --- |
| Wire protocol | | | | | | |
| Tool design | | | | | | |
| Resources/prompts | | | | | | |
| Transports | | | | | | |
| Client/host | | | | | | |
| MRTR | | | | | | |
| Auth | | | | | | |
| Security | | | | | | |
| Operations | | | | | | |
| Compatibility | | | | | | |
| Influence | | | | | | |

Target: 4+ everywhere, 5 on at least four rows.
