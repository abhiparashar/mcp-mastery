from mcp.server.mcpserver import MCPServer
from pathlib import Path
from mcp.server.mcpserver.resources import FileResource
from mcp.server.mcpserver.exceptions import ResourceNotFoundError, ToolError

server = MCPServer(name="notes-server")

NOTES_DIR = Path(__file__).parent/ "notes"
NOTES_DIR.mkdir(exist_ok=True)
for path in NOTES_DIR.glob("*.md"):
  server.add_resource(FileResource(uri=f"note://{path.stem}", name=path.stem, path=path, mime_type="text/markdown"))

@server.tool()
def create_note(title:str, text:str) -> str:
  """Get the title and text from the notes and create a note in notes"""
  path = (NOTES_DIR / f"{title}.md").resolve()
  if path.parent != NOTES_DIR.resolve():
    raise ToolError("Title must be a plain name, without / or ..")
  path.write_text(text)
  server.add_resource(FileResource(uri=f"note://{title}", name=title, path=path, mime_type="text/markdown"))
  return "file is saved successfully"

@server.tool()
def search_notes(query:str) -> list[str] :
  """Find notes whose title or text contains the query (ignores upper/lower case). Returns matching note titles."""
  query = query.lower()
  matches = []
  for path in NOTES_DIR.glob("*.md"):
    title = path.stem
    text = path.read_text()

    if query in title.lower() or query in text.lower():
      matches.append(title)
  return matches

@server.resource("note://{title}", mime_type="text/markdown")
def read_note(title: str) -> str:
  """Read one note by its title."""
  path = NOTES_DIR / f"{title}.md"
  if not path.exists():
    raise ResourceNotFoundError(f'No note called "{title}". Use search_notes to find titles.')
  return path.read_text()


if __name__ == "__main__":  
  server.run()
