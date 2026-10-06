# T5 API Wrapper (Hacker News)

An MCP server that wraps the public Hacker News APIs in **3 task-shaped tools**: one tool per kind of question, not one tool per API address. Written in Python with the official `mcp` library (`MCPServer`) and `httpx`.

## Tools

| Tool | Answers | API behind it |
| --- | --- | --- |
| `top_stories(count)` | "What's on HN right now / trending / today?" | `hacker-news.firebaseio.com/v0/topstories.json`, then one `item/<id>.json` per story |
| `search_stories(query, count)` | "Has HN discussed X?" | `hn.algolia.com/api/v1/search` |
| `story_details(story_id, comment_count)` | "What are people saying about story N?" | `hn.algolia.com/api/v1/items/<id>`: story and comments in one request |

Every list line ends with `id <n>`, so the model can pass it straight to `story_details`. Comments arrive as HTML; `clean_html` turns them into plain text and each is cut to 300 characters.

## How to run it

```bash
npx @modelcontextprotocol/inspector@latest uv --directory "$PWD" run server.py
claude mcp add hacker-news -- uv --directory "$PWD" run server.py
```

## Done-when test: does the model pick the right tool?

10 natural questions, asked through Claude Code (`claude -p`) with its own terminal and web tools turned off (`--disallowedTools Bash WebFetch WebSearch`), so only these tools were available. Scored on the **first** tool it picked.

| # | Question | Right tool |
| --- | --- | --- |
| 1 | What's on the Hacker News front page right now? | `top_stories` |
| 2 | Show me the top 3 HN stories. | `top_stories` |
| 3 | What's the most upvoted story on HN today? | `top_stories` |
| 4 | Is anything about Mistral trending on HN right now? | `top_stories` |
| 5 | Has HN discussed the Model Context Protocol? | `search_stories` |
| 6 | Find HN posts about Rust in the Linux kernel. | `search_stories` |
| 7 | Any popular HN stories about SQLite? | `search_stories` |
| 8 | What are people saying about HN story 42237424? | `story_details` |
| 9 | Show the comments on story 42237424. | `story_details` |
| 10 | What did HN commenters think of Anthropic's MCP announcement? | `search_stories` |

### Scores

| Version | Runs | Score | Misses |
| --- | --- | --- | --- |
| First docstrings | 2 | **9/10**, 9/10 | Q4 both times: picked `search_stories("Mistral")` first, then `top_stories` |
| `top_stories` docstring adds "Use this for anything trending, popular, or on HN right now or today, including 'is anything about X trending?': check the front page first." | 2 | **10/10**, 10/10 | none |
| Experiment: `top_stories` removed | 1 | 6/10 | Q1–Q3: no tool called. Q4: `search_stories("Mistral")` |

**Scoring note:** Claude Code loads MCP tools on demand, so it often calls its own `ToolSearch` first, just to load my tool. That is not a choice between my tools, so it is skipped when scoring. Counting it gave a misleading 3/10.

### Remove one tool, re-score

With `top_stories` removed, Claude refused rather than fake an answer:

> I can't pull the live front page with what I have here. The Hacker News tools in this session are only `search_stories`, which searches by topic, and `story_details` ... Its own description says it isn't for the current front page. ... I'd rather not run a search and present the results as the front page, because they wouldn't be.

The "not for the current front page" sentence in `search_stories` kept it from misusing the wrong tool.

### `tools/list` cost

| Tools | `tools/list` size |
| --- | --- |
| 3 (all) | 2,099 characters, about 524 tokens |
| 2 (`top_stories` removed) | 1,432 characters, about 358 tokens |

Token counts are estimates (characters ÷ 4). Every tool description is sent to the model with **every** request, so each tool costs about 170 tokens per turn, whether used or not. That is why "at most 4 task-shaped tools" matters.

## Real messages

Captured from this server over stdio.

**Search**:

```json
>> {"method": "tools/call", "params": {"name": "search_stories", "arguments": {"query": "model context protocol", "count": 2}}}
<< {"content": [{"type": "text", "text": "Model Context Protocol | 872 points | 258 comments | 2024-11-25 | https://www.anthropic.com/news/model-context-protocol | id 42237424\nDonating the Model Context Protocol and establishing the Agentic AI Foundation | 288 points | 145 comments | 2025-12-09 | https://www.anthropic.com/news/donating-the-model-context-protocol-and-establishing-of-the-agentic-ai-foundation | id 46207425"}], "isError": false}
```

**Story with comments** (HTML cleaned):

```json
>> {"method": "tools/call", "params": {"name": "story_details", "arguments": {"story_id": 42237424, "comment_count": 1}}}
<< {"content": [{"type": "text", "text": "Model Context Protocol | 872 points | by benocodes | 2024-11-25 | https://www.anthropic.com/news/model-context-protocol\n\nTop comments:\n- somnium_sn: @jspahrsummers and I have been working on this for the last few months at Anthropic. I am happy to answer any questions people might have."}], "isError": false}
```

**Unknown id** (`ToolError`) and **nothing found** (a normal answer, not an error):

```json
<< {"content": [{"type": "text", "text": "Error executing tool story_details: No Hacker News item with id 999999999999."}], "isError": true}
<< {"content": [{"type": "text", "text": "No Hacker News stories found for \"zzqqxxnotathing\"."}], "isError": false}
```

## What the library did for me

1. **Built each tool's input schema** from type hints and `Field(...)`: `ge`/`le` became `minimum`/`maximum`, and `description` became text the model reads.
2. **Rejected impossible inputs** before my code ran (see the swapped `ge`/`le` bug below).
3. **Ran my plain `def` tools on a worker thread**, so slow HTTP calls don't freeze the server.

## What broke, and what I learned

| What happened | Why | Lesson |
| --- | --- | --- |
| `top_storiesOutput ... Input should be a valid list` | `-> list[str]` but returned one joined string | The return type is a promise the library checks. |
| Only 1 story fetched instead of 3 | `return` was indented inside the `for` loop | Indentation decides what's inside a loop. |
| Every `count` rejected, even the default | `Field(le=1, ge=10)`: "at most 1 and at least 10" | `ge` = lowest allowed, `le` = highest allowed. |
| HN errors would slip through | `response.raise_for_status` without `()` | Without `()` a function is only named, never run. |
| Unused imports: `operator.ge/le`, `turtle.reset`, `mcp.server` | Editor autocomplete on Enter | Press Esc before Enter. |
| Q4 "Is anything about Mistral trending?" went to search first | Docstrings didn't say which tool owns "trending" | Docstrings should say **when** to use a tool, not only what it does. 9/10 → 10/10. |

## Known gaps

- **`top_stories` is slow.** It makes one request per story, one after another: about 3 seconds for 3 stories.
- **Network errors are generic.** A timeout or HN being down crashes the tool, so the model only sees `Error executing tool <name>`.
