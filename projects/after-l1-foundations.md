# Build after L1 - Protocol foundations

Concepts required: [L0 Prerequisites](../roadmap/00-prerequisites.md),
[L1 Protocol core](../roadmap/01-protocol-core.md).

Both projects here ban the SDK on purpose. You are learning the wire, and the SDK exists to
hide the wire.

---

### S04 — Bare-Metal JSON-RPC

- **Size:** `[S]` half a day to one day
- **Unlocked after:** L1
- **Concepts:** JSON-RPC framing, stdio transport, `_meta` per-request fields,
  `server/discover`, `resultType`, error codes

**Goal.** Write an MCP server and a caller with **zero dependencies**, so you can never
again be confused about what the SDK is doing.

**Requirements**

1. Server reads newline-delimited JSON from stdin, writes frames to stdout, logs only to
   stderr.
2. Implements `server/discover` returning `supportedVersions`, `capabilities`,
   `instructions`, `_meta['io.modelcontextprotocol/serverInfo']`, `ttlMs`, `cacheScope`.
3. Implements `tools/list` (2 tools, deterministic order, cache hints) and `tools/call`.
4. Every result includes `resultType: "complete"`.
5. Validates required `_meta`: missing `io.modelcontextprotocol/protocolVersion` or
   `io.modelcontextprotocol/clientCapabilities` -> JSON-RPC `-32602`.
6. Unknown method -> `-32601`. Unsupported requested version -> `-32022` with the list of
   supported versions.
7. One tool requires the `elicitation` client capability; called without it, return `-32021`
   with `data.requiredCapabilities`.
8. A caller script (shell or any language, still no SDK) that pipes five requests in and
   pretty-prints the responses.

**Acceptance**

- `printf '<frames>' | node server.js` produces valid frames for all five cases above.
- A table in the README: request sent -> exact response code -> spec link for the rule.
- Nothing but JSON-RPC ever appears on stdout (verify by piping stdout through a JSON parser
  that fails loudly).

**Stretch.** Add `notifications/progress` with a `progressToken`, and honour
`notifications/cancelled` by aborting mid-work.

**Mastery marker.** You can explain, without notes, why `stdout` purity matters and why a
stdio process is not a session.

---

### S06 — Tiny Client CLI

- **Size:** `[S]` one to two days
- **Unlocked after:** L1
- **Concepts:** client duties, version negotiation, `resultType` handling, cache hints,
  era compatibility

**Goal.** A command-line MCP client you wrote yourself: `mcp discover`, `mcp tools`,
`mcp call <tool> '<json>'`.

**Requirements**

1. Spawns a stdio server (configurable command) and speaks raw frames. No MCP SDK.
2. Sends required `_meta` on every request, including `clientInfo` and
   `clientCapabilities`; supports `--log-level` mapping to
   `io.modelcontextprotocol/logLevel`.
3. Version strategy: try preferred version; on `-32022`, read the server's
   `supportedVersions` and retry once.
4. Reads `resultType`; treats **absent** as `"complete"`; rejects unknown values with a
   clear message.
5. Honours `ttlMs`/`cacheScope` for `tools/list` in an in-memory cache; `--no-cache` flag;
   never reuses a `private` entry across two different credentials.
6. Never reuses an outstanding JSON-RPC id; ids are monotonic and logged.
7. `--raw` prints the exact frames both ways, aligned, for debugging.

**Acceptance**

- Works against your S04 server **and** one published SDK-based server.
- `mcp tools` twice in a row hits the cache; after `ttlMs` expires it re-fetches. Prove it
  with timestamps in `--raw` output.
- Pointing it at a server that only speaks an older revision produces a clean, single
  fallback, not a crash.

**Stretch.** Add Streamable HTTP support with the required headers
(`MCP-Protocol-Version`, `Mcp-Method`, `Mcp-Name`) and handle both `application/json` and
`text/event-stream` responses.

**Mastery marker.** Era handling lives in exactly one adapter, not scattered across
commands.
