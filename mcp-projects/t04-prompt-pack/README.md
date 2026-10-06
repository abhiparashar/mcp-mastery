# T4 Prompt Pack

An MCP server with 3 reusable prompts for jobs I repeat. A prompt is a template **I** pick (like a slash-command). It fills in my text and sends it to the model as my message. Written in Python with the official `mcp` library (`MCPServer`).

## Prompts

| Prompt | Blanks | What it asks the model |
| --- | --- | --- |
| `review_code` | `code` | List bugs, then readability problems, then safety risks. Keep it short. |
| `commit_message` | `message` (paste `git diff`) | First line under 72 characters saying what changed, a blank line, then 1–3 lines on why. |
| `explain_error` | `error`, `language` (autocomplete) | Explain the error in simple words: what caused it, then how to fix it. |

`language` autocompletes from: python, javascript, typescript, java, go, rust. Typing `ja` suggests `javascript`, `java`. Matching ignores upper/lower case.

## Tools vs resources vs prompts: who controls each

| Block | Who picks it | Example in my projects |
| --- | --- | --- |
| **Tool** | The **model** decides to call it | `search_notes` (T2), `file_history` (T3) |
| **Resource** | The **app**, or me attaching it | `@note://shopping` (T2) |
| **Prompt** | **Me**, as a slash-command | `/mcp__prompt-pack__explain_error` |

A prompt does nothing by itself. It only builds a message; the model does the work after I send it.

## How to run it

```bash
npx @modelcontextprotocol/inspector@latest uv --directory "$PWD" run server.py
claude mcp add prompt-pack -- uv --directory "$PWD" run server.py
```

In Claude Code, type `/` and pick `mcp__prompt-pack__review_code`, `mcp__prompt-pack__commit_message` or `mcp__prompt-pack__explain_error`.

## Done-when test

In Claude Code, the 3 prompts appeared in the `/` menu. I used `/mcp__prompt-pack__explain_error` and `/mcp__prompt-pack__review_code`, and Claude answered from my templates.

## Real messages

Captured from this server over stdio.

**`initialize`**: the server announces prompts and completions:

```json
{"capabilities": {"completions": {}, "prompts": {"listChanged": false}, "resources": {"listChanged": false, "subscribe": false}, "tools": {"listChanged": false}}}
```

**`prompts/list`**: what the app shows in its menu (shown for `explain_error`):

```json
{"name": "explain_error", "description": "Explain an error message in simple words, and how to fix it.", "arguments": [{"name": "error", "required": true}, {"name": "language", "required": true}]}
```

**`prompts/get`**: my template filled in, returned as a **user** message:

```json
>> {"method": "prompts/get", "params": {"name": "explain_error", "arguments": {"error": "ZeroDivisionError: division by zero", "language": "python"}}}
<< {"description": "Explain an error message in simple words, and how to fix it.", "messages": [{"role": "user", "content": {"type": "text", "text": "Explain this python error in simple words. Say what caused it, then how to fix it.\n\nZeroDivisionError: division by zero"}}]}
```

**`completion/complete`**: autocomplete:

```json
>> {"method": "completion/complete", "params": {"ref": {"type": "ref/prompt", "name": "explain_error"}, "argument": {"name": "language", "value": "ja"}}}
<< {"completion": {"values": ["javascript", "java"]}}
```

**Errors**: a missing blank and an unknown prompt:

```json
>> {"method": "prompts/get", "params": {"name": "explain_error", "arguments": {"error": "boom"}}}
<< {"error": {"code": 0, "message": "Missing required arguments: {'language'}"}}

>> {"method": "prompts/get", "params": {"name": "nope", "arguments": {}}}
<< {"error": {"code": 0, "message": "Unknown prompt: nope"}}
```

## What the library did for me

1. **Turned my function into a prompt definition.** The function name became the prompt name, the docstring its description, and each parameter a required argument.
2. **Wrapped my returned string as a `user` message** inside `messages`.
3. **Added `"completions": {}` to the capabilities** as soon as I registered `@server.completion()`, so the app knows it may ask for suggestions.
4. **Rejected a `prompts/get` with a missing blank** before my function ran.

## What broke, and what I learned

| What happened | Why | Lesson |
| --- | --- | --- |
| Got `{"result": "Review this code..."}` instead of a message | Used `@server.tool()` instead of `@server.prompt()` | A tool is for the model to call; a prompt is for me to pick. The output shape shows which one you built. |
| `explain_error` failed: `Error rendering prompt explain_error` | The text used `{language}` but the function had no `language` parameter | Every `{blank}` in the template needs a matching parameter. |
| Unused imports: `tkinter.messagebox`, `re.match` | Editor autocomplete on Enter | Press Esc to close a suggestion before pressing Enter. |

## Known gaps

- **Prompt errors use code `0`.** The library answers a missing blank and an unknown prompt with `"code": 0`, which is not a JSON-RPC error code. The spec's code for bad parameters is `-32602` (T2's missing note uses it). The cause is in the library, not my code.
- **Arguments have no descriptions.** `prompts/list` shows only `name` and `required` for each blank, so the app can't explain what to type.
