# T6 Go Remote

The T5 Hacker News server, served over **Streamable HTTP** as well as stdio. Same tools, same file; only the last lines choose how messages arrive. Written in Python with the official `mcp` library (`MCPServer`) and `httpx`.

Tools (unchanged from T5): `top_stories`, `search_stories`, `story_details`. See [T5's README](../t05-api-wrapper/README.md).

## stdio vs HTTP

| | stdio (T1–T5) | Streamable HTTP (T6) |
| --- | --- | --- |
| Who starts the server | The app, as a hidden child program | Me, once; it keeps running |
| How messages travel | One pipe: the program's input and output | Each message is its own web request to `/mcp` |
| How many apps can use it | One | Many at once |
| How an app finds it | A start command | A URL |

## The only code change

```python
# sys.argv = the words typed after "uv run server.py", e.g. ["server.py", "--http"]
import sys

if __name__ == "__main__":
  if "--http" in sys.argv:
    server.run(transport="streamable-http", port=8765)
  else:
    server.run()
```

The tools say **what** to do; `server.run(...)` decides **how** messages arrive. That is why the same handler code serves both.

## How to run it

```bash
# HTTP: start it yourself, it listens on http://127.0.0.1:8765/mcp
uv run server.py --http
claude mcp add --transport http hn-remote http://127.0.0.1:8765/mcp

# stdio: the app starts it, exactly like T5
claude mcp add hacker-news -- uv --directory "$PWD" run server.py
```

Inspector over HTTP: run `npx @modelcontextprotocol/inspector@latest` with no command, add a **Streamable HTTP** server with URL `http://127.0.0.1:8765/mcp`, and connect.

## Done-when test

**By URL.** Claude Code, with its own tools and T5's stdio server turned off (`--disallowedTools Bash WebFetch WebSearch mcp__hacker-news`), asked *"Has HN discussed the Model Context Protocol?"*. Its log shows:

```
mcp__hn-remote__search_stories(query="model context protocol", count=10)
```

**Same code over stdio.** The same `server.py`, started without `--http` by an MCP client over stdio, answered `search_stories` with `Model Context Protocol | 872 points | 258 comments | 2024-11-25 | ...`, on protocol version `2026-07-28`.

## Real messages over HTTP

Captured with `curl` against `uv run server.py --http`.

**`initialize`**: a `POST`. The server opens a session and returns its id in a header. The answer arrives as a server-sent event (`text/event-stream`):

```
POST /mcp
Content-Type: application/json
Accept: application/json, text/event-stream

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}

HTTP/1.1 200 OK
content-type: text/event-stream
mcp-session-id: b5aecae4a332434488a77c2d0981fa0c

event: message
data: {"jsonrpc":"2.0","id":1,"result":{"capabilities":{"prompts":{"listChanged":false},"resources":{"listChanged":false,"subscribe":false},"tools":{"listChanged":false}},"protocolVersion":"2025-11-25","serverInfo":{"name":"api-wrapper","version":""}}}
```

**`notifications/initialized`**: a one-way note, so there is nothing to answer:

```
HTTP/1.1 202 Accepted
```

**`tools/call`**: every later request carries the session id (`mcp-session-id`) and protocol version (`mcp-protocol-version`) headers:

```
event: message
data: {"jsonrpc":"2.0","id":2,"result":{"content":[{"text":"Model Context Protocol | 872 points | 258 comments | 2024-11-25 | https://www.anthropic.com/news/model-context-protocol | id 42237424","type":"text"}],"isError":false,...}}
```

**Server log for one Inspector connection**: one line per message:

```
Created new transport with session ID: c3df9b734a8241e78f6a3da48a80ba65
"POST /mcp HTTP/1.1" 200 OK        ← initialize
"POST /mcp HTTP/1.1" 202 Accepted  ← notifications/initialized
"GET /mcp HTTP/1.1" 200 OK         ← long-lived channel for server → client messages
"POST /mcp HTTP/1.1" 200 OK        ← tools/list, tools/call, ...
```

## What the library did for me

1. **Ran a web server** (Uvicorn) and the whole `/mcp` endpoint from one line: `server.run(transport="streamable-http", port=8765)`.
2. **Managed sessions**: created an id at `initialize`, and rejected a request without one:
   ```
   HTTP/1.1 400 Bad Request
   {"jsonrpc":"2.0","id":null,"error":{"code":-32600,"message":"Bad Request: Missing session ID"}}
   ```
3. **Listened on this computer only**: it binds to `127.0.0.1:8765`, so other computers can't connect.
4. **Rejected a fake `Host` header** (DNS-rebinding protection): a request with `Host: evil.example.com` got `421 Misdirected Request` / `Invalid Host header`. This stops a malicious web page in my browser from reaching the local server.
5. **Served both protocol eras on one URL**: a `2025-11-25` client (with handshake and session) and a `2026-07-28` client (no handshake) both worked.

## What broke, and what I learned

| What happened | Why | Lesson |
| --- | --- | --- |
| A long `KeyboardInterrupt` traceback after Ctrl+C, and `Failed to get PID` | Ctrl+C stops Python; the second Ctrl+C hit while it was already shutting down | Not a bug. Press Ctrl+C once and wait. |
| Claude answered via `hacker-news` (T5, stdio) instead of `hn-remote` | Both servers were registered with identical tools | When testing one server, turn the others off (`--disallowedTools mcp__<name>`) and check the log for which one was called. |
| New Inspector shows a server list, not a connect form | Newer Inspector UI | Clone the built-in HTTP example and change its URL. |

## Known gaps

- **No login.** Anyone on this computer who can reach `127.0.0.1:8765` can use the tools. Fine locally; a real remote server needs auth (T10).
- **Fixed port.** `8765` is hard-coded; if it is taken, the server fails to start.
- **The code is a copy of T5.** A fix in one project does not reach the other.
