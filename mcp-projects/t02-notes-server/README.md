# T2 Notes Server

An MCP server over a folder of Markdown notes (`notes/*.md`). Each note is a **resource** the app can attach directly. Searching and creating notes are **tools** the model decides to call. Written in Python with the official `mcp` library (`MCPServer`).

## What it has

| Kind | Name | What it does |
| --- | --- | --- |
| Resource (one per note) | `note://<title>` | The contents of `notes/<title>.md`. Listed so the app can show it in its attach menu. |
| Resource template | `note://{title}` | The same address as a pattern, for any title. |
| Tool | `search_notes(query)` | Titles of notes whose title or text contains `query`, ignoring upper/lower case. |
| Tool | `create_note(title, text)` | Saves `notes/<title>.md` and lists it as a resource right away. |

## Resource or tool?

| | Resource | Tool |
| --- | --- | --- |
| What it is | Data you read | An action |
| Who picks it | Usually the user (attaches it) | The model decides |
| Changes anything? | No | It can |
| Identified by | A URI, e.g. `note://shopping` | A name, e.g. `create_note` |

Reading a note is data, so it is a resource. Creating a note changes things, and searching needs the model to choose a query, so both are tools.

## How to run it

```bash
npx @modelcontextprotocol/inspector@latest uv --directory "$PWD" run server.py
claude mcp add notes-server -- uv --directory "$PWD" run server.py
```

In Claude Code, type `@` and pick `notes-server:note://shopping` to attach a note.

## Real messages

Captured from this server over stdio.

**`resources/list`**: the notes the app can offer:

```json
{"resources": [{"mimeType": "text/markdown", "name": "shopping", "uri": "note://shopping"}]}
```

**`resources/templates/list`**: the pattern:

```json
{"resourceTemplates": [{"description": "Read one note by its title.", "mimeType": "text/plain", "name": "read_note", "uriTemplate": "note://{title}"}]}
```

**`resources/read`**: no tool call involved:

```json
>> {"method": "resources/read", "params": {"uri": "note://shopping"}}
<< {"contents": [{"mimeType": "text/markdown", "text": "milk, eggs", "uri": "note://shopping"}]}
```

**`tools/call` `search_notes`**:

```json
>> {"method": "tools/call", "params": {"name": "search_notes", "arguments": {"query": "MILK"}}}
<< {"content": [{"text": "shopping", "type": "text"}], "isError": false, "structuredContent": {"result": ["shopping"]}}
```

**`create_note`, then `resources/list` again**: the new note is listed immediately:

```json
{"resources": [{"mimeType": "text/markdown", "name": "shopping", "uri": "note://shopping"}, {"mimeType": "text/markdown", "name": "todo", "uri": "note://todo"}]}
```

**`create_note` with title `../escaped`**: blocked:

```json
{"content": [{"text": "Error executing tool create_note: Title must be a plain name, without / or ..", "type": "text"}], "isError": true}
```

## What the library did for me

1. **Two kinds of resource from one decorator.** `@server.resource("note://{title}")` became a template because of the `{title}` blank. `FileResource` made fixed, listed resources that read the file for me.
2. **Blocked path tricks in resource addresses.** `note://..%2Fs` (`../s`) never reached my code: the template matcher rejects path traversal by default.
3. **Filled in the message shapes.** `resources/read` got `contents`, `uri` and `mimeType` without me writing them. `search_notes` returning a Python list became both text `content` and `structuredContent`.

## What broke, and what I learned

| What happened | Why | Lesson |
| --- | --- | --- |
| `list[str] notesList = []` → `SyntaxError` | Java-style declaration | Python puts the name first: `notes_list: list[str] = []`. |
| `create_note` returned `None` | `list.append()` returns nothing | Return a real message, and keep the `-> str` promise. |
| Notes vanished on restart | A Python list lives only in memory | Store notes as files. |
| Title `../escaped` wrote a file **outside** `notes/` | `..` means "go up one folder" | `.resolve()` the path, then check it is still inside `notes/`. Use `if` (it succeeded, but it was wrong), not `try` (nothing failed). |
| A template alone did not show notes in the attach menu | A template is a pattern, not a list | Register each note with `add_resource`. |
| New notes did not appear until restart | The startup loop runs once | Register the note inside `create_note`, right after saving. |
| `add_resource` placed in `search_notes` | Wrong place: it only ran when someone searched, and re-added old notes (`Resource already exists`) | Put a change where the thing changes. |
| Auto-imports (`from operator import add`, `from sys import exception`, `import glob`) | Editor autocomplete | Press Esc when autocomplete pops up for a name you don't need to import. |

## Known gaps

- **Missing note → generic error.** `resources/read` on `note://missing` returns `{"code": -32603, "message": "Error creating resource from template note://missing"}`. `-32603` means "internal error"; a not-found resource should get a clearer answer.
- **Clients are not told the list changed.** The server advertises `"listChanged": false`, so an app may keep showing the old list until it reconnects.
- **Template says `text/plain`, listed notes say `text/markdown`** for the same files.
