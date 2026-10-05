# T3 Git Buddy

A read-only MCP server over a local git repo. Its tools run `git` and hand the output to the AI, so it can answer questions like "why did this file change?". Written in Python with the official `mcp` library (`MCPServer`).

## Tools

| Tool | Git command behind it | Answers |
| --- | --- | --- |
| `recent_commits(count)` | `git log -<count>` | What changed lately in the whole repo? |
| `file_history(path, count)` | `git log -<count> -- <path>` | Which commits touched this file? |
| `diff_summary(commit)` | `git show --stat --end-of-options <commit>` | What did this commit change: message, files, line counts? |
| `who_touched(path)` | `git shortlog -sn HEAD -- <path>` | Who changed this file, and how often? |

`count` is limited to 1–50, so a tool never dumps thousands of commits. `diff_summary` returns a summary (`--stat`), not the full diff, for the same reason. On top of that, `run_git` caps every result at 10,000 characters and ends a cut result with `... output cut at 10000 characters`, so even a commit touching thousands of files can't flood the AI.

Git runs from the repo's top folder (`git rev-parse --show-toplevel`), so paths are written from there, e.g. `mcp-projects/t02-notes-server/server.py`.

## How to run it

```bash
npx @modelcontextprotocol/inspector@latest uv --directory "$PWD" run server.py
claude mcp add git-buddy -- uv --directory "$PWD" run server.py
```

## Done-when test

Asked Claude Code: *"use the git-buddy tools only: why did mcp-projects/t02-notes-server/server.py change recently?"*. It called:

```
file_history(path="mcp-projects/t02-notes-server/server.py")
diff_summary(commit="2424e6b")
diff_summary(commit="ff27498")
```

It then explained each of the four commits correctly from their messages and file stats.

## Real messages

Captured from this server over stdio.

**Success**: `diff_summary`:

```json
>> {"method": "tools/call", "params": {"name": "diff_summary", "arguments": {"commit": "2424e6b"}}}
<< {"content": [{"text": "2424e6b 2026-10-05 Abhishek Parashar\nT2 Notes Server: missing note returns -32602 not found; template is text/markdown\n\n\n mcp-projects/t02-notes-server/README.md | 3 +--\n mcp-projects/t02-notes-server/server.py | 9 ++++++---\n 2 files changed, 7 insertions(+), 5 deletions(-)\n", "type": "text"}], "isError": false}
```

**Tool error** (`isError: true`): git failed, and the AI reads why:

```json
>> {"method": "tools/call", "params": {"name": "diff_summary", "arguments": {"commit": "nope"}}}
<< {"content": [{"text": "Error executing tool diff_summary: git failed: fatal: ambiguous argument 'nope': unknown revision or path not in the working tree. ...", "type": "text"}], "isError": true}
```

**Blocked option injection**:

```json
>> {"method": "tools/call", "params": {"name": "diff_summary", "arguments": {"commit": "--output=/tmp/t3_pwned.txt"}}}
<< {"content": [{"text": "Error executing tool diff_summary: git failed: fatal: option '--output=/tmp/t3_pwned.txt' must come before non-option arguments", "type": "text"}], "isError": true}
```

**Input rejected by the library before my code ran**:

```json
>> {"method": "tools/call", "params": {"name": "recent_commits", "arguments": {"count": 0}}}
<< {"content": [{"text": "Error executing tool recent_commits: 1 validation error for recent_commitsArguments\ncount\n  Input should be greater than or equal to 1 ...", "type": "text"}], "isError": true}
```

## Tool errors vs protocol errors

| Kind | Looks like | Who should react | Example here |
| --- | --- | --- | --- |
| **Tool error** | A normal `result` with `isError: true` | The **AI**: it reads the text and can retry | `git failed: ... 'nope'`, `count = 0` |
| **Protocol error** | A JSON-RPC `error` with a code | The **app** | T2's missing note: `-32602` |

A `ToolError` (or a failed input check) is a tool error, so the AI sees it and can correct itself.

## What the library did for me

1. **Checked `count` against 1–50** before my function ran.
2. **Turned `ToolError` into `isError: true`** with my message, while hiding the details of unexpected crashes.
3. **Ran my plain `def` tools on a worker thread**, so a slow `git` call does not freeze the server (visible in the traceback: `anyio.to_thread.run_sync`).

## What broke, and what I learned

| What happened | Why | Lesson |
| --- | --- | --- |
| `TypeError: can only concatenate list (not "CompletedProcess") to list` | `result = command + subprocess.run(...)` | Read the last traceback line pointing at my file. |
| `file_history` returned `""` for a correct path | Git ran inside `t03-git-buddy`, so `mcp-projects/...` did not exist from there | Run git from the repo's top folder. |
| Bad commit `nope` returned `""` | Only `stdout` was returned; git's error was in `stderr` | Check `returncode`, raise `ToolError` with `stderr`. One fix in `run_git` covers every tool. |
| `who_touched` missing; log said `Tool already exists: diff_summary` | Second function had the same name | Every tool needs its own name. |
| `diff_summary("--output=/tmp/t3_pwned.txt")` **created that file** | Git reads anything starting with `--` as an option. A list stops the *shell*, not git's own option parsing. | Put `--end-of-options` (or `--` for paths) before any value from the AI. |
| Claude answered without my tools ("Ran 1 shell command") | Claude Code has its own terminal tool | The model chooses. In apps without a terminal, these tools are the only way in. |
| `file_history("does/not/exist.py")` returned `""` with `isError: false` | Git succeeds with no output when a path matches nothing | Turn a silent empty result into a `ToolError` that says how to fix the path: `No commits found for "does/not/exist.py". Check the spelling, and that the path starts from the repo top folder ...` |
| A commit touching thousands of files would return all of them | `--stat` lists every file | Cap output in one place (`run_git`) and say clearly when it was cut. |

## Rules I follow with `subprocess`

- Pass a **list**, never a string with `shell=True`.
- Put `--end-of-options` or `--` before any value that came from the AI.
- `git shortlog` needs `HEAD`; without it, git waits for typed input and the tool hangs.

