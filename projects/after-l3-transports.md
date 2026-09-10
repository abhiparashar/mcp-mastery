# Build after L3 - Transports

Concepts required: [L3 Transports](../roadmap/03-transports.md).

Everything here is about behaviour under real network conditions: proxies, timeouts,
disconnects.

---

### S05 — Streamable HTTP Deploy

- **Size:** `[S]` one to two days
- **Unlocked after:** L3
- **Concepts:** Streamable HTTP rules, required headers, status codes, Origin validation,
  proxy behaviour

**Goal.** Take the server from S01/S02 and serve it over Streamable HTTP on a real host,
correctly.

**Requirements**

1. One POST endpoint (`/mcp`). No GET stream, no session header - both were removed in
   2026-07-28.
2. Reject requests whose `MCP-Protocol-Version` header disagrees with
   `_meta['io.modelcontextprotocol/protocolVersion']`: `400` + `HeaderMismatch` (`-32020`).
3. Correct statuses: unknown method `404` + `-32601`; unsupported version `400` + `-32022`
   with supported list; missing required `_meta` `400` + `-32602`; invalid `Origin` `403`.
4. Notifications receive `202 Accepted` with no body.
5. Answer at least one method with plain `application/json` and one with
   `text/event-stream`, and prove your client handles both.
6. Deploy behind a real reverse proxy or platform (nginx, Caddy, or a PaaS). Include
   `X-Accel-Buffering: no` on SSE responses.
7. Transport-agnostic core: the same handlers still run under stdio, selected by a flag.

**Acceptance**

- A `curl` script in the repo exercises all six status/error cases and asserts them.
- The same Inspector CLI script passes against both stdio and HTTP modes.
- Deployed URL works from a host application with only a URL, no local install.

**Stretch.** Add a tool parameter annotated with `x-mcp-header` and show the resulting
`Mcp-Param-*` header being used for routing in your proxy config.

**Mastery marker.** You can state, per header, what breaks when it is missing or wrong.

---

### S07 — Progress and Cancel

- **Size:** `[S]` half a day to one day
- **Unlocked after:** L3
- **Concepts:** `progressToken`, `notifications/progress`, cancellation semantics per
  transport, abort propagation

**Goal.** A long-running tool that streams honest progress and stops instantly when
abandoned.

**Requirements**

1. A tool that takes 20-60 seconds of real work in chunks.
2. Emits `notifications/progress` **only** when the request carried a `progressToken`, with
   `progress`, `total`, and a human-readable `message`.
3. The final response terminates the SSE stream.
4. Cancellation: on HTTP, a closed response stream stops the work; on stdio,
   `notifications/cancelled` does. One shared abort path, wired into every downstream call.
5. After cancellation, nothing further is sent for that request id, and no downstream work
   continues.
6. A broken stream is *not* resumed: your client re-issues with a **new** id.

**Acceptance**

- Log file shows zero downstream activity after an abort, in both transports.
- Client abort at 1 s consistently kills work within ~100 ms.
- Progress messages are readable by a human ("processed 1200/5000 files"), not raw counters.

**Stretch.** Add a per-principal cap on concurrent streams and prove the 4th concurrent
call is rejected with a model-readable error.

**Mastery marker.** Cancellation is real work-stopping, not just an ignored signal.

---

### S08 — Subscriptions Watcher

- **Size:** `[S]` one day
- **Unlocked after:** L3
- **Concepts:** `subscriptions/listen`, opt-in notification types, `subscriptionId`,
  keep-alives, TTL-versus-notification invalidation

**Goal.** A server whose data changes underneath it, and a client that learns about changes
correctly.

**Requirements**

1. Watch a directory (or table) and expose the items as resources with
   `resources: { listChanged: true, subscribe: true }`.
2. Implement `subscriptions/listen` supporting `resourcesListChanged` and
   `resourceSubscriptions` for specific URIs; acknowledge the subscription.
3. Every notification on that stream carries
   `_meta['io.modelcontextprotocol/subscriptionId']`.
4. Emit `notifications/resources/updated` on change and
   `notifications/resources/list_changed` on add/remove.
5. Keep the stream alive with periodic SSE comment lines; verify it survives a 30-second
   proxy idle timeout.
6. Request-scoped notifications (progress, log) must **never** appear on the listen stream.
7. Correctness without listeners: a client that never subscribes still gets fresh data via
   `ttlMs` expiry.

**Acceptance**

- With a subscriber attached, touching a file produces exactly one correlated notification.
- Kill the stream: the server drops the subscription and stops emitting.
- A 60-second quiet period does not drop the stream behind a proxy.

**Stretch.** Add coalescing: 100 rapid changes in one second produce at most a couple of
notifications, and document the tradeoff.

**Mastery marker.** Your server is correct whether or not anyone is listening.
