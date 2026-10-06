from mcp.server.mcpserver import MCPServer

server = MCPServer(name="prompt-pack")

@server.prompt()
def review_code(code:str)->str:
  """Review code for bugs, readability, and safety."""
  return f"Review this code. List bugs first, then readability problems, then safety risks. Keep it short.\n\n{code}"

@server.prompt()
def commit_message(message:str) ->str:
  """Write a commit message for the given changes (paste the output of git diff)."""
  return f"Write a git commit message for these changes. First line: under 72 characters, says what changed. Then a blank line and 1-3 lines on why.\n\n{message}"

@server.prompt()
def explain_error(error:str,language: str) ->str:
  """Explain an error message in simple words, and how to fix it."""
  return f"Explain this {language} error in simple words. Say what caused it, then how to fix it.\n\n{error}"

if __name__ == "__main__":
  server.run()