# Turns HTML codes like &#x27; back into normal characters like '
import html
# re = regular expressions: find text by pattern
import re
import httpx
from typing import Annotated
from pydantic import Field
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

server = MCPServer(name="api-wrapper")

HN_API = "https://hacker-news.firebaseio.com/v0"
SEARCH_API = "https://hn.algolia.com/api/v1/search"
ITEM_API = "https://hn.algolia.com/api/v1/items"

@server.tool()
def top_stories(count:Annotated[int, Field(ge=1,le=10, description="How many stories to show")]=5)->str:
  """Show the stories on the Hacker News front page right now: title, points, comment count, link, and story id. Use this for anything trending, popular, or on HN right now or today, including "is anything about X trending?": check the front page first."""
  response = httpx.get(f"{HN_API}/topstories.json", timeout=10)
  response.raise_for_status()
  story_ids = response.json()
  lines = []

  for story_id in story_ids[:count]:
    story = httpx.get(f"{HN_API}/item/{story_id}.json", timeout=10).json()
    title = story.get("title", "(no title)")
    points = story.get("score", 0)
    comments = story.get("descendants", 0)
    link = story.get("url", f"https://news.ycombinator.com/item?id={story_id}")
    lines.append(f"{title} | {points} points | {comments} comments | {link} | id {story_id}")
  # Runs once, after the loop has finished every story
  return "\n".join(lines)


@server.tool()
def search_stories(
  query: Annotated[str, Field(description="Words to search for, e.g. model context protocol")],
  count: Annotated[int, Field(ge=1, le=10, description="How many stories to show")] = 5
)->str:
  """Search all Hacker News stories by topic: title, points, comment count, date, link, and story id. Use this for questions about a topic, not for the current front page."""
  response = httpx.get(SEARCH_API, params={"query":query,"tags": "story", "hitsPerPage": count}, timeout=10)
  response.raise_for_status()
  hits = response.json()["hits"]
  lines = []
  for hit in hits:
    title = hit.get("title") or "(no title)"
    points = hit.get("points") or 0
    comments = hit.get("num_comments") or 0
    date = hit.get("created_at", "")[:10]
    story_id = hit["objectID"]
    link = hit.get("url") or f"https://news.ycombinator.com/item?id={story_id}"
    lines.append(f"{title} | {points} points | {comments} comments | {date} | {link} | id {story_id}")

  # Nothing found → say so clearly, instead of an empty "" (lesson from T3)
  if len(lines) == 0:
    return f'No Hacker News stories found for "{query}".'
  return "\n".join(lines)

# A helper, not a tool: HN comment HTML → plain text
def clean_html(text: str) -> str:
  # Replace every <tag> (like <p> or <a href=...>) with a space
  text = re.sub(r"<[^>]+>", " ", text)
  # &#x27; → '   &quot; → "
  text = html.unescape(text)
  # Squash runs of spaces and newlines into single spaces
  return " ".join(text.split())

@server.tool()
def story_details(
  story_id: Annotated[int, Field(description="Story id, e.g. 42237424 (from top_stories or search_stories)")],
  comment_count: Annotated[int, Field(ge=0, le=10, description="How many top comments to show")] = 5,
) -> str:
  """Show one Hacker News story with its top comments: what people are saying about it. Needs a story id."""
  response = httpx.get(f"{ITEM_API}/{story_id}", timeout=10)
  # 404 = "no such id" → a clear message Claude can act on
  if response.status_code == 404:
    raise ToolError(f"No Hacker News item with id {story_id}.")
  response.raise_for_status()
  story = response.json()

  title = story.get("title") or "(no title)"
  points = story.get("points") or 0
  author = story.get("author") or "unknown"
  date = (story.get("created_at") or "")[:10]
  link = story.get("url") or f"https://news.ycombinator.com/item?id={story_id}"
  lines = [f"{title} | {points} points | by {author} | {date} | {link}", "", "Top comments:"]

  shown = 0
  # "children" = the comments directly under the story
  for comment in story.get("children", []):
    text = comment.get("text")
    # Skip deleted comments (no text), and stop once we have enough
    if text and shown < comment_count:
      # [:300] keeps each comment short, so the answer stays small
      lines.append(f"- {comment.get('author')}: {clean_html(text)[:300]}")
      shown = shown + 1

  if shown == 0:
    lines.append("(no comments)")
  return "\n".join(lines)


if __name__ == "__main__":
  server.run()

