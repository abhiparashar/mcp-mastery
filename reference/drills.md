# Drills: interview questions, design prompts, review rubric

Three sections. Use them to test yourself, to test others, and to review real servers.

---

## Interview questions with answer keys

Answer out loud, in under a minute each. If you hedge, go back to the level.

### Fundamentals

1. **What problem does MCP solve that plain function calling did not?**
   Standardises where the tool list comes from and who executes calls, so integrations
   become configuration instead of bespoke code. It does not change the model's tool-calling
   loop.

2. **Who chooses tools, resources and prompts?**
   Model, application, user respectively.

3. **Why is a stdio process not a session?**
   The protocol is stateless: clients may interleave unrelated requests on one process, and
   servers must not infer context from connection identity.

### Protocol core

4. **Which `_meta` fields are required on every request, and what happens if one is missing?**
   `io.modelcontextprotocol/protocolVersion` and `.../clientCapabilities`. Missing means
   malformed: `-32602`, HTTP `400`.

5. **A server needs elicitation but the client did not declare it. What do you return?**
   `-32021 MissingRequiredClientCapability` with `data.requiredCapabilities`, HTTP `400`.

6. **A result arrives with no `resultType`. What do you do?**
   Treat it as `"complete"` - that is the backwards-compatibility rule for older servers.

7. **Why were sessions and `initialize` removed?**
   Sessions forced sticky routing and cross-replica state. Statelessness makes any replica
   able to serve any request and makes list results cacheable by intermediaries.

8. **Where does multi-request state live now?**
   In server-minted handles passed as ordinary arguments, or in integrity-protected
   `requestState` for MRTR.

### Server design

9. **When is a failure an `isError` result versus a JSON-RPC error?**
   Business failure -> result with `isError: true` so the model can recover. Invalid request
   (unknown tool, bad params, missing `_meta`) -> JSON-RPC error.

10. **Why must `tools/list` be deterministically ordered?**
    Byte-stable payloads enable client caching and LLM prompt-cache hits.

11. **May `tools/list` differ between two callers?**
    Yes by the authorization presented on the request; never by connection or as a side
    effect of other requests.

12. **Which six operations must carry cache hints, and what are the two fields?**
    `server/discover`, `tools/list`, `prompts/list`, `resources/list`,
    `resources/templates/list`, `resources/read`; `ttlMs` (>= 0) and `cacheScope`
    (`public`/`private`).

13. **Is `cacheScope: "public"` safe on an authenticated endpoint?**
    Only if the payload has no user-specific data - public results can be shared across
    authorization contexts. It is a hint, never an access control.

### Transports

14. **List the required Streamable HTTP request headers.**
    `MCP-Protocol-Version` (must equal the `_meta` value), `Mcp-Method`, and `Mcp-Name` for
    `tools/call`/`resources/read`/`prompts/get`; `Mcp-Param-*` when `x-mcp-header` applies;
    `Authorization` when protected.

15. **Header says 2026-07-28 and the body says 2025-11-25. What happens?**
    `400` with `HeaderMismatch` (`-32020`).

16. **How does cancellation work on each transport?**
    Client to server: HTTP closes the response stream, which the server must treat as
    cancellation; stdio sends `notifications/cancelled`. Server to client, on **any**
    transport: a server **MUST** send `notifications/cancelled` referencing a
    `subscriptions/listen` request when it tears that stream down, and **MUST NOT** send
    it for anything else.

17. **The SSE stream dies mid-call. What does a correct client do?**
    Re-issues the request; there is no `Last-Event-ID` resumption. A new id is practical
    advice, not a spec rule - the only **MUST** for a new id is the MRTR retry.

18. **Where do change notifications come from now?**
    The response stream of a `subscriptions/listen` request, tagged with
    `io.modelcontextprotocol/subscriptionId`, for the types the client opted into.

### MRTR

19. **Walk through MRTR on `tools/call`.**
    Server returns `resultType: "input_required"` with `inputRequests` and/or
    `requestState`; client fulfils the requests and retries the original request with
    `inputResponses` plus the exact `requestState` under a new id; server completes.

20. **Which methods may return `input_required`?**
    `tools/call`, `resources/read`, `prompts/get`. No others.

21. **What must go inside `requestState`, and why?**
    Integrity protection (HMAC/AEAD), the authenticated principal, a short TTL, and a digest
    of the originating method plus salient params - because the blob passes through a
    possibly malicious client. Single-use must be enforced server-side if required.

### Auth and security

22. **Two tokens, both validly signed by your IdP, one minted for another API. Which do you accept?**
    Only the one whose audience is your canonical server URI. Accepting the other is token
    passthrough.

23. **Explain the confused deputy attack on an MCP proxy and two mitigations.**
    Static third-party client id plus dynamic client registration plus a consent cookie lets
    a crafted request skip consent and deliver the code to an attacker `redirect_uri`.
    Mitigations: per-client consent stored server-side and checked before forwarding; exact
    `redirect_uri` matching; single-use `state` set only after consent.

24. **When do you reject an authorization response over `iss`?**
    When the AS advertises `iss` support and `iss` is absent, or when a present `iss` does
    not string-match the recorded issuer. No normalisation before comparison.

25. **Which MCP features are deprecated, and what replaces them?**
    Roots (pass paths as arguments/resources), Sampling (call the provider directly),
    Logging (stderr/OTel), HTTP+SSE (Streamable HTTP), DCR (CIMD), and
    `includeContext: "thisServer"` / `"allServers"` on sampling (omit it or use `"none"`).
    Earliest removal is per feature, not a flat window: the first four in the first
    revision released on or after 2027-07-28, HTTP+SSE three months after SEP-2596 is
    Final.

---

## Design prompts

Whiteboard these in 30-45 minutes each, with tradeoffs and failure modes.

1. **Company-wide MCP platform.** 200 engineers, 30 internal APIs, SSO. Design the server
   topology, gateway, auth, tenancy, and the tool-approval process. What is centralised and
   what is owned by teams?
2. **Agent over production databases.** Read-only guarantees, cost control, PII, auditing.
   What is enforced by the database, what by the server, what by the host?
3. **Migrating a 2025-06-18 server fleet to 2026-07-28.** Order of work, dual-era support,
   how you avoid breaking existing clients, rollout and rollback.
4. **A server with 500 tools.** How do you keep an agent accurate? Filtering,
   search-for-tools, per-task subsets - and how you measure the result.
5. **Long jobs, hostile network.** Two-hour job, clients disconnect. Tasks extension versus
   handles, durability, idempotency, resumption, cancellation.
6. **Untrusted third-party servers in your host.** Sandboxing, consent, tool-diff detection,
   result size caps, injection containment.
7. **Multi-region deployment.** Statelessness helps, but what about caching, `cacheScope`,
   data residency, and per-region tool availability?
8. **A protocol change you would propose.** Pick a real friction point, write it as a SEP
   sketch: problem, alternatives, migration, minimal surface.

---

## Review rubric

Score any MCP server out of 40. Below 30 means do not ship.

### Protocol correctness (10)

- [ ] `server/discover` implemented, with `instructions` and honest `supportedVersions` (2)
- [ ] Required `_meta` validated; correct `-32602` / `-32021` / `-32022` / `-32020` behaviour (2)
- [ ] `resultType` on every result; `input_required` only on the three allowed methods (2)
- [ ] Cache hints on all six cacheable operations; consistent `cacheScope` across pages (2)
- [ ] Correct transport rules (headers, statuses, notification `202`, stream close) (2)

### Tool and data design (10)

- [ ] Tools are task-shaped, not endpoint-shaped (2)
- [ ] Descriptions written for a model, with limits and non-use cases (2)
- [ ] Schemas constrain inputs; `outputSchema` where results are consumed programmatically (2)
- [ ] Results bounded, with truncation stated; large payloads use `resource_link` (2)
- [ ] Resources and prompts used where they belong, with templates plus completion (2)

### Safety and security (10)

- [ ] Audience-validated tokens; no token passthrough (2)
- [ ] Scope-driven visibility and enforcement; tenancy from claims (2)
- [ ] Business failures as `isError`; destructive actions flagged and confirmable (2)
- [ ] Untrusted content contained (resources, descriptions, app UI) (2)
- [ ] `requestState` signed and replay-bound; `Origin` validated; secrets never in headers/logs (2)

### Operability (10)

- [ ] Cancellation propagates and stops real work (2)
- [ ] Traces, metrics per tool, redacted structured logs (2)
- [ ] Quotas and caps per principal (2)
- [ ] Tests: unit, conformance, integration, plus a tool-selection eval in CI (2)
- [ ] Versioned, documented revisions supported, published, with a rollback path (2)

Write findings as: **finding -> evidence (frames or code) -> impact -> fix -> how to verify.**
Ten of these reviews will make you faster at judging servers than almost anyone.
