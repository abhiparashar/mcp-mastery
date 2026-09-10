# Build after L4 - Clients and hosts

Concepts required: [L4 Clients and hosts](../roadmap/04-clients-and-hosts.md).

---

### S09 — MRTR Elicitation

- **Size:** `[S]` one to two days
- **Unlocked after:** L4
- **Concepts:** `InputRequiredResult`, `inputRequests`, `inputResponses`, signed
  `requestState`, new-id retry rule

**Goal.** Implement the multi round-trip pattern on both sides, with the security that the
spec demands.

**Requirements**

1. A tool that cannot complete without a value the caller did not supply (for example a
   target account or a confirmation).
2. First call returns `resultType: "input_required"` with an `elicitation/create` request in
   `inputRequests` (form mode, with `requestedSchema`) plus `requestState`.
3. Server sends the elicitation request **only** if the client declared the `elicitation`
   capability; otherwise return `-32021`.
4. `requestState` is integrity-protected (HMAC or AEAD) and contains: authenticated
   principal, short TTL, and a digest of the method plus salient params. All three verified
   on retry.
5. Client side (extend S06): prompts the user, retries with `inputResponses` and the exact
   `requestState`, using a **new** JSON-RPC id.
6. Multiple rounds work: if the user gives an invalid value, the server asks again instead
   of erroring.
7. Neither the `input_required` result nor the MRTR retry result is cached.

**Acceptance**

- Happy path: call -> prompt -> retry -> final result, with frames captured in the README.
- Tamper one byte of `requestState` -> rejected.
- Replay a valid `requestState` as a different principal -> rejected.
- Replay after TTL -> rejected.
- Replay on a different method/params -> rejected.

**Stretch.** Add a second `inputRequests` entry in the same result and fulfil both in one
retry.

**Mastery marker.** You can explain how MRTR removes the need for sticky sessions and
shared state between replicas.

---

### M05 — MCP Gateway/Router

- **Size:** `[M]` one to two weeks
- **Unlocked after:** L4
- **Concepts:** aggregation, namespacing, caching, budgets, trust boundaries, observability

**Goal.** One MCP endpoint in front of many servers - the piece every company builds
eventually.

**Requirements**

1. Connect to N upstream servers (mixed stdio and HTTP) and expose a single MCP server
   downstream.
2. Namespace tools (`github.search_issues`), resolve collisions deterministically, and
   never rely on `serverInfo.name` for uniqueness.
3. Allow/deny policy per upstream and per tool, loaded from config, enforced on both
   `tools/list` and `tools/call`.
4. Cache upstream lists honouring their `ttlMs`/`cacheScope`; re-emit correct hints
   downstream; never mix `private` results across credentials.
5. Per-upstream timeouts and a circuit breaker: one dead upstream degrades the tool list, it
   does not fail the request.
6. Propagate `traceparent` and preserve `progressToken`, progress notifications, and
   cancellation through both hops.
7. Forward MRTR faithfully: pass `input_required` downstream and `inputResponses` +
   `requestState` back upstream, untouched.
8. Never forward client tokens blindly upstream - mint or exchange credentials per upstream
   (see [token passthrough](../roadmap/05-auth-and-security.md#token-passthrough)).
9. Enforce a downstream tool budget: cap total tools exposed and log what was dropped.

**Acceptance**

- Three upstreams aggregated; kill one and show graceful degradation with a clear log line.
- Cancellation from the far client stops work in the upstream server (prove with logs).
- One end-to-end trace spanning client -> gateway -> upstream -> dependency.
- Tool count and token size of the aggregated `tools/list` documented, before and after
  filtering.

**Stretch.** Add a "tool search" mode: expose a single `find_tools` tool for large fleets
instead of the full list, and measure the token and accuracy effect.

**Mastery marker.** The gateway is a real trust boundary - policy, credentials and budgets
are enforced there, not assumed from upstream.
