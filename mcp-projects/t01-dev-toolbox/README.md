# T1 Dev Toolbox

My first MCP server. It gives an AI app three small developer tools. Written in Python with the official `mcp` library (`MCPServer`).

## What it does

| Tool | What it does |
| --- | --- |
| `convert_timestamp` | Turns a Unix timestamp (seconds or milliseconds) into a readable date in any IANA time zone, e.g. `Asia/Kolkata`. |
| `generate_uuid` | Makes 1 to 100 random UUIDs. |
| `format_json` | Pretty-prints JSON. If the JSON is broken, says the exact line and column. |

## How to run it

Test by hand in the Inspector:

```bash
npx @modelcontextprotocol/inspector@latest uv --directory "$PWD" run server.py
```

Connect it to Claude Code:

```bash
claude mcp add dev-toolbox -- uv --directory "$PWD" run server.py
```

Any other MCP app (Gemini CLI, Cursor, ...) needs the same two facts, a name and a start command, usually in a JSON settings file:

```json
{ "mcpServers": { "dev-toolbox": { "command": "uv", "args": ["--directory", "/full/path/to/t01-dev-toolbox", "run", "server.py"] } } }
```

The server itself has nothing Claude-specific in it.

## Real messages

Captured from this server over stdio.

**`tools/list`**: what the AI sees about a tool (shown for `convert_timestamp`):

```json
{
  "name": "convert_timestamp",
  "description": "\nConvert a Unix timestamp to a readable date and time. Seconds or milliseconds (13 digits) both work.\ntimezone must be an IANA name, for example \"Asia/Kolkata\" or \"UTC\".\n",
  "inputSchema": {
    "properties": {
      "timestamp": { "title": "Timestamp", "type": "integer" },
      "timezone": { "title": "Timezone", "type": "string" }
    },
    "required": ["timestamp", "timezone"],
    "type": "object",
    "title": "convert_timestampArguments"
  },
  "outputSchema": {
    "properties": { "result": { "title": "Result", "type": "string" } },
    "required": ["result"],
    "type": "object",
    "title": "convert_timestampOutput"
  }
}
```

**`tools/call`**: success:

```json
>> {"method": "tools/call", "params": {"name": "convert_timestamp", "arguments": {"timestamp": 1727600000, "timezone": "Asia/Kolkata"}}}
<< {"result": {"content": [{"text": "2024-09-29 14:23:20 IST", "type": "text"}], "isError": false, "structuredContent": {"result": "2024-09-29 14:23:20 IST"}}}
```

**`tools/call`**: my own error (`ToolError`):

```json
>> {"method": "tools/call", "params": {"name": "convert_timestamp", "arguments": {"timestamp": 1727600000, "timezone": "IST"}}}
<< {"result": {"content": [{"text": "Error executing tool convert_timestamp: Unknown timezone \"IST\". Use an IANA name like \"Asia/Kolkata\" or \"UTC\".", "type": "text"}], "isError": true}}
```

## What the library did for me

1. **Turned Python into JSON Schema.** I wrote type hints and a docstring. The library built `inputSchema` and `outputSchema` from them. `Field(ge=1, le=100)` became `"minimum": 1, "maximum": 100`.
2. **Checked inputs before my code ran.** `count = 0` never reached `generate_uuid`. The library rejected it with `Input should be greater than or equal to 1`.
3. **Checked my outputs before sending them.** When I wrote `-> str` but returned a list, the library refused to send the wrong answer.
4. **Wrapped my answer.** I returned a plain string. The library sent it twice: as `content` (text for the AI) and as `structuredContent` (data for programs), plus `isError`.
5. **Hid crash details.** When my code crashed, the AI only saw `Error executing tool ...`. The real error went to the server log.

## What broke, and what I learned

| What happened | Why | Lesson |
| --- | --- | --- |
| `count = 0` → error with full details | Bad **input**, caught by the library | The caller's mistake gets a clear message automatically. |
| `-> str` but returned a list → `Error executing tool generate_uuid`, no details | Bad **output**, my bug | My bugs are hidden from the AI. Fix the code, don't hide it. |
| Broken JSON in `format_json` | `json.loads` fails | Catch the expected error and `raise ToolError` with a helpful message. |
| `timezone = "IST"` crashed | `IST` is not an IANA name | Same fix: `ToolError` that says how to fix it, so the AI can retry. |
| `1727600000000` crashed (`year must be in 1..9999`) | Milliseconds treated as seconds | Detect big numbers and divide by 1000. |
| `ZoneInfo(zone)` → `TypeError` | Passed the time zone object back in where a name was expected | Reuse the value I already have. Reconnect the Inspector after saving, or it runs the old code. |
| Asked Claude "what is 1727600000 in IST?" and it answered **without** my tool | The model decides whether to call a tool | Connecting a tool does not mean the model will use it. |
| When asked to use the tool, Claude sent `timezone: "Asia/Kolkata"`, not `IST` | It read my docstring | The docstring is the only instruction every AI reads. |

## Try-except rule I follow

Use `try / except` only when a line can fail because of **outside input** and I know **what to do** about it. Name the exact error. Never use it to hide my own bugs.
