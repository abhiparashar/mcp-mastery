from mcp.server.mcpserver import MCPServer
from pathlib import Path
from mcp.server.mcpserver.exceptions import ToolError

server = MCPServer(name="notes-server")

NOTES_DIR = Path(__file__).parent/ "notes"
NOTES_DIR.mkdir(exist_ok=True)

@server.tool()
def create_note(title:str, text:str) -> str:
  """Get the title and text from the notes and create a note in notes"""
  path = (NOTES_DIR / f"{title}.md").resolve()
  if path.parent != NOTES_DIR.resolve():
    raise ToolError("Title must be a plain name, without / or ..")
  path.write_text(text)
  return "file is saved successfully"

@server.resource("note://{title}")
def read_note(title: str) -> str:
  """Read one note by its title."""
  return (NOTES_DIR / f"{title}.md").read_text()


if __name__ == "__main__":  
  server.run()
