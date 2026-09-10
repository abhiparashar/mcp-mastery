# Build after L7 - Extensions and frontier

Concepts required: [L7 Extensions and frontier](../roadmap/07-extensions-and-frontier.md).

---

### M03 — Long Jobs With the Tasks Extension

- **Size:** `[M]` one week
- **Unlocked after:** L7
- **Concepts:** extension negotiation, `io.modelcontextprotocol/tasks`, polling with
  `tasks/get`, `tasks/update`, graceful fallback

**Goal.** Run work that takes minutes to hours, survives disconnects, and still works for
clients that have never heard of the extension.

**Requirements**

1. A genuinely long job (bulk export, repo-wide analysis, batch enrichment) with durable
   state, so a restarted server can still answer for a running task.
2. Implement the Tasks extension: advertise it in `extensions` capabilities, return task
   handles, support polling via `tasks/get` and client input via `tasks/update`. No
   blocking result call, no `tasks/list` - both are gone in the redesign.
3. **Fallback path** for clients without the extension: a server-minted `job_id` returned by
   `start_export`, plus `get_export_status` and `cancel_export` tools. Same underlying
   engine.
4. Capability gating: never use extension messages with a client that did not advertise
   support; never accept a `resultType` you did not advertise.
5. Cancellation and cleanup: cancelling releases resources and marks the task terminal.
6. Idempotency: starting the same job twice with the same key returns the same handle.

**Acceptance**

- One job driven to completion through the extension, and the same job through the fallback
  tools, from two different clients.
- Kill the client mid-job: the job continues and can be re-attached by handle.
- Restart the server mid-job: state survives, status is still answerable.
- README table comparing the two paths: code size, client support, failure behaviour.

**Stretch.** Add progress *inside* the task and surface it both as
`notifications/progress` on a polling request and as a status field.

**Mastery marker.** You can argue when Tasks is the right choice and when a plain handle is
better, with your own measurements behind it.

---

### M04 — MCP App UI

- **Size:** `[M]` one week
- **Unlocked after:** L7
- **Concepts:** MCP Apps, interactive results, host rendering, untrusted-content threat
  model

**Goal.** Replace a clumsy conversational flow with a small interactive interface inside the
host.

**Requirements**

1. Pick a flow that is genuinely bad as text: choose one of 50 rows, approve a diff, pick a
   date range, watch a job.
2. Build the app following [Build an MCP App](https://modelcontextprotocol.io/extensions/apps/build);
   a tool result renders the panel.
3. Selection in the UI feeds the next tool call with typed arguments, not free text.
4. Graceful degradation: on a host without Apps support, the same tool returns a usable
   text/`structuredContent` result. Check the
   [client support matrix](https://modelcontextprotocol.io/extensions/client-matrix) and
   state which hosts you tested.
5. Threat model, written: what the app renders, where that content originates, what it can
   ask the host to do, and how you bound each. Treat rendered content as untrusted -
   escaping, size caps, no credentialed fetches for third-party assets.
6. Accessibility and size basics: keyboard usable, bounded payload, no unbounded lists.

**Acceptance**

- Screen recording of the flow with the app, and the same flow without it, side by side.
- Injection attempt embedded in the rendered data does nothing.
- Works in at least one host with Apps support and one without.

**Stretch.** Add live updates to the panel driven by a `subscriptions/listen` stream.

**Mastery marker.** The app is the *fallback-safe* path, not a hard dependency.
