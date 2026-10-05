import subprocess
from pathlib import Path
from typing import Annotated
from pydantic import Field
from mcp.server.mcpserver import MCPServer

server = MCPServer(name="git-buddy")

# REPO = Path(__file__).parent
top = subprocess.run(["git", "rev-parse", "--show-toplevel"], cwd=Path(__file__).parent, capture_output=True, text=True)
REPO = Path(top.stdout.strip())

def run_git(args:list[str])->str:
  command = ["git"] + args
  result = subprocess.run(command, cwd=REPO, capture_output=True, text=True)
  return result.stdout

@server.tool()
def recent_commits(count: Annotated[int, Field(ge=1, le=50, description="How many commits to show")] = 10) -> str:
     """List the most recent commits in the repo: short hash, date, author, and message."""
     return run_git(["log", f"-{count}", "--pretty=format:%h %ad %an %s", "--date=short"])

@server.tool()
def file_history(
    path: Annotated[str, Field(description="File path from the repo's top folder, e.g. mcp-projects/t02-notes-server/server.py")],
    count:Annotated[int, Field(ge=1, le=50, description="How many commits to show")] = 10,
)->str:
    """List the commits that changed one file, newest first: short hash, date, author, and message."""
    return run_git(["log", f"-{count}", "--pretty=format:%h %ad %an %s", "--date=short", "--", path])
    
    

if __name__ == "__main__":
    server.run()