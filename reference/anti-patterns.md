# Anti-patterns

The mistakes that mark someone as junior, grouped by area. Each has the fix. Use this as a
self-review before you publish anything.

---

## Protocol

| Anti-pattern | Why it is wrong | Fix |
| --- | --- | --- |
| Assuming a session or connection identity | MCP is stateless; unrelated requests share connections | Server-minted handles or signed `requestState` |
| Caching client identity/capabilities per connection | Same connection can carry different principals | Read `_meta` on every request |
| Omitting `resultType` | Required on every result | Add it; clients treat absent as `complete` |
| Rejecting results that lack `resultType` | Breaks every older server | Treat absent as `complete` |
| Emitting `-32002` for missing resources | Retired in this revision | Emit `-32602`, still accept `-32002` as a client |
| Inventing codes in `-32020..-32099` | Reserved for the spec | Use your own range outside `-32768..-32000` |
| Silently falling back when a client capability is missing | Hides bugs, produces wrong behaviour | Return `-32021` with `data.requiredCapabilities` |
| Reusing the JSON-RPC id on an MRTR retry or stream re-issue | Illegal | New id per request |
| Inspecting or rewriting `requestState` in a client | Illegal and breaks signing | Echo it byte-for-byte |
| Unsigned `requestState` that affects authorization | Attacker-controlled input | HMAC/AEAD + principal + TTL + request digest |

## Tool design

| Anti-pattern | Why it is wrong | Fix |
| --- | --- | --- |
| One tool per REST endpoint | Explodes the tool list, mirrors your internals not the user's intent | Task-shaped tools |
| Forty tools "for completeness" | Token cost every turn, more wrong choices | Cut to the ten that matter; measure accuracy |
| Descriptions written for humans | The model reads them as prompt text | State purpose, when to use, when not to, limits |
| Constraints only in prose | Models follow schemas more reliably | `enum`, bounds, `default`, `additionalProperties: false` |
| Business failure as a JSON-RPC error | The model cannot see or recover from it | `isError: true` with a recovery hint |
| Unbounded results | Context blowouts and cost spikes | Page, cap, truncate, or return `resource_link` |
| Raw upstream JSON dumped as text | Wastes tokens, confuses the model | Shape the result; add `outputSchema` |
| Non-deterministic tool order | Kills client and prompt caching | Sort deterministically |
| Tool list varying per connection | Explicitly illegal | Vary by authorization only |
| Secrets in `x-mcp-header` parameters | Headers are visible to intermediaries | Never annotate sensitive params |
| No idempotency on write tools | Models retry | Accept an idempotency key |

## Resources and prompts

| Anti-pattern | Fix |
| --- | --- |
| Exposing file reads as tools with no resources | Model data as resources; keep tools for actions |
| Flat, unguessable URI schemes | Hierarchical, stable, template-friendly URIs |
| Templates without `completion/complete` | Add completion; it is what makes the surface usable |
| No prompts at all | Turn your three most repeated workflows into prompts |
| Prompts that restate resource content | Embed the resource instead |

## Transport

| Anti-pattern | Fix |
| --- | --- |
| `console.log` on stdio | Log to stderr; stdout is frames only |
| Expecting a GET SSE endpoint or `Mcp-Session-Id` | Both removed; POST-only, no sessions |
| Retrying a broken stream with the same id | New request, new id |
| Sending progress without a `progressToken` | Only when the client opted in |
| Logs to clients that never set `logLevel` | Suppress them |
| Request-scoped notifications on the listen stream | Keep them on their request's stream |
| No SSE keep-alive on long streams | Emit comment lines; add `X-Accel-Buffering: no` |
| Binding locally to `0.0.0.0`, skipping `Origin` checks | Bind `127.0.0.1`; validate `Origin`, `403` on mismatch |
| Ignoring cancellation | Thread an abort signal into every downstream call |

## Auth and security

| Anti-pattern | Fix |
| --- | --- |
| Accepting any validly signed token | Validate audience = your canonical URI |
| Forwarding the client's token downstream | Exchange for your own service credential |
| Skipping the `resource` parameter | Required on authorize and token requests |
| Normalising `iss` before comparison | Exact string comparison, no folding |
| Proxy without per-client consent | Store consent per `client_id`, check before third-party redirect |
| Wildcard or pattern `redirect_uri` matching | Exact string match, re-registration on change |
| Reusable or long-lived `state` | Random, single-use, short expiry, set only after consent |
| New code using Dynamic Client Registration | Use Client ID Metadata Documents |
| Trusting `serverInfo`, `clientInfo`, or tool `annotations` | Display only; never a security input |
| Treating `cacheScope: "public"` as isolation | Enforce authorization per request |
| Tenancy from a `tenant_id` argument | Derive tenancy from token claims |
| Auto-dereferencing network `$ref` | Disabled by default; allowlist if ever enabled |
| Logging tokens, `requestState`, or raw arguments | Redact at the logger |

## Operations

| Anti-pattern | Fix |
| --- | --- |
| No SLOs, no load test | Write p95/error-rate targets; test to them |
| No tracing | Propagate `traceparent` into every downstream call |
| Rate limiting by IP | Limit per authenticated principal |
| Huge `ttlMs` while iterating | Modest list TTLs during rapid change |
| Long SSE streams on short-timeout serverless | Choose a runtime that matches the transport |
| Advertising revisions you do not test | Test matrix per era, or drop the claim |
| Shipping a tool-list change with no diff visibility | Version tools, log diffs, re-consent on change |
| "We added OAuth" with no threat model | Fill in the threat-model table per tool |

## Career-level

| Anti-pattern | Fix |
| --- | --- |
| Learning MCP only through SDK examples | Hand-roll the wire once per concept |
| Reading 2025-era tutorials as current | Check the revision; translate eras deliberately |
| No measurements | Tool-selection accuracy, token size, p95, cost |
| Only building servers | Build a client, a host, and a gateway |
| Private practice only | Publish repos, reviews, articles, upstream issues |
