# Glossary

Plain-word definitions. If you cannot explain a term this simply, you do not own it yet.

**MCP** - Model Context Protocol. A JSON-RPC 2.0 protocol that connects AI applications to
external tools and data through a standard interface.

**Host** - the AI application the user talks to (desktop assistant, IDE plugin, your
agent). Owns the model, the conversation, and the policy about what the model may do.

**Client** - the connector inside a host that speaks MCP to exactly one server. Twelve
servers means twelve clients.

**Server** - the process that exposes tools, resources and prompts.

**Tool** - an action the **model** may choose to call. Described by a name, description and
JSON Schema.

**Resource** - data addressed by URI that the **application** chooses to read and attach.

**Prompt** - a reusable template the **user** picks, usually a slash command.

**Capability** - a declaration of what a side supports. Servers declare theirs in
`server/discover`; clients declare theirs per request in `_meta`.

**`server/discover`** - the RPC every server must implement, returning supported protocol
versions, capabilities, identity, `instructions` and cache hints.

**Stateless** - every request contains everything needed to serve it. No handshake, no
session, no reliance on previous requests on the same connection.

**`_meta`** - the metadata bag on requests, results and notifications. Carries protocol
version, client capabilities, client/server identity, log level, progress token and trace
context.

**`resultType`** - required field on every result: `"complete"` for a final answer,
`"input_required"` for an MRTR interim result.

**MRTR (Multi Round-Trip Requests)** - the pattern replacing server-initiated requests. The
server returns `input_required` with `inputRequests`; the client gathers the input and
retries the original request (new JSON-RPC id) with `inputResponses`.

**`inputRequests` / `inputResponses`** - matched maps of server-asked questions and
client-supplied answers, keyed by server-chosen ids.

**`requestState`** - an opaque, server-owned blob returned with an `input_required` result
and echoed back byte-for-byte by the client. Must be integrity-protected because it travels
through the client.

**Elicitation** - asking the end user for input, delivered through MRTR. Form mode uses a
`requestedSchema`; URL mode sends the user out of band.

**Sampling** - a server asking the client's model to generate text. **Deprecated**; call
the LLM provider directly instead.

**Roots** - a client telling a server which directories it may use. **Deprecated**; pass
paths as tool parameters or resource URIs.

**stdio transport** - the client launches the server as a subprocess and exchanges
newline-delimited JSON over stdin/stdout. Logs go to stderr.

**Streamable HTTP transport** - a single HTTP endpoint that accepts POST. Each message is
its own POST; each response is either one JSON object or an SSE stream scoped to that
request.

**SSE (Server-Sent Events)** - a long-lived HTTP response of `text/event-stream` that pushes
events. Used for per-request streaming and for subscriptions.

**`subscriptions/listen`** - one long-lived request whose response stream carries the change
notifications a client opted into (`toolsListChanged`, `promptsListChanged`,
`resourcesListChanged`, `resourceSubscriptions`).

**`subscriptionId`** - the `_meta` key correlating a notification with the subscription that
asked for it.

**`progressToken`** - a value the client puts in `_meta` to opt into
`notifications/progress` for that request.

**Cancellation** - stopping in-flight work. On Streamable HTTP, closing the response stream
is the signal; on stdio it is `notifications/cancelled`.

**Pagination cursor** - an opaque token returned as `nextCursor` and passed back as
`cursor`. Clients must never parse it.

**`ttlMs`** - a freshness hint in milliseconds, like HTTP `max-age`.

**`cacheScope`** - `"public"` (shareable with anyone, including shared proxies) or
`"private"` (reusable only within the same authorization context).

**`structuredContent`** - machine-readable result data on a tool call, validated against the
tool's `outputSchema`. Unrelated to LLM "structured outputs".

**`outputSchema`** - optional JSON Schema describing a tool's structured result.

**`isError`** - the flag on a tool result meaning the tool ran and failed for business
reasons. Different from a JSON-RPC error, which means the request itself was invalid.

**`x-mcp-header`** - a JSON Schema annotation on a tool parameter that mirrors its value
into an `Mcp-Param-{Name}` HTTP header so intermediaries can route without reading the body.

**Extension** - optional protocol functionality negotiated through the `extensions` field of
capabilities. Official ones include Tasks, MCP Apps and the auth extensions.

**Tasks extension** - `io.modelcontextprotocol/tasks`: long-running work with `tasks/get`
polling and `tasks/update` for client input.

**MCP Apps** - an extension letting a server return interactive UI rendered inside the host.

**Server-minted handle** - an id the server issues (job id, cursor token) that the client
passes back as an ordinary argument. The stateless replacement for sessions.

**Protected Resource Metadata (PRM, RFC 9728)** - the `.well-known` document your server
publishes telling clients which authorization servers to use.

**Authorization server (AS)** - the OAuth component that authenticates the user and issues
tokens.

**Resource indicator (RFC 8707)** - the `resource` parameter naming which server a token is
for. Required on authorize and token requests.

**Audience validation** - the server checking that a presented token was minted *for it*.
Skipping this is how token passthrough happens.

**Token passthrough** - the anti-pattern of accepting or forwarding tokens not issued for
your server.

**Confused deputy** - an attack on proxy servers with a static third-party client id plus
dynamic client registration, where a consent cookie lets an attacker skip the consent screen
and steal an authorization code.

**CIMD (Client ID Metadata Documents)** - registration where the client's `client_id` is an
HTTPS URL serving its metadata. Preferred over Dynamic Client Registration, which is
deprecated.

**PKCE** - proof that the app redeeming an authorization code is the one that started the
flow.

**`iss` validation (RFC 9207)** - comparing the issuer returned in the authorization
response against the recorded issuer before redeeming the code, with no string
normalisation.

**SEP** - Specification Enhancement Proposal. The process for changing MCP: a markdown file
in `seps/`, PR-derived number, a sponsor, status tracked by labels.

**Feature lifecycle** - Active / Deprecated / Removed, with a minimum twelve-month
deprecation window.

**MCP Registry** - the official index where servers are published so clients can discover
and install them.

**Inspector** - the official debugging tool, with web, CLI and TUI clients. The CLI is the
one to wire into CI.

**Protocol era** - informal term for a group of revisions with the same core model. The
big divide is pre-2026 (handshake + sessions) versus 2026-07-28 (stateless).
