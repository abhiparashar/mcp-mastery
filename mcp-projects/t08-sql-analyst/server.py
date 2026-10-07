import sqlite3
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

DATABASE_FILE = "shop.db"

server = MCPServer(name="sqlitetool")

def open_database():
  address = "file:" + DATABASE_FILE + "?mode=ro"
  connection = sqlite3.connect(address, uri=True)
  return connection 

@server.tool()
def list_tables() ->str:
  """List every table in the shop database. Use this first to see what data exists."""
  connection = open_database()
  rows = connection.execute("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").fetchall()
  connection.close()
  names = []

  for row in rows:
    names.append(row[0])
  return "\n".join(names)

@server.tool()
def describe_table(table:str)->str:
  """Show the columns of one table: each column's name and type. Use this before writing a query, so you use real column names."""
  connection = open_database()

  rows = connection.execute("SELECT name, type FROM pragma_table_info(?)", (table,)).fetchall()

  connection.close()

  if len(rows) == 0:
    raise ToolError(f"No table named '{table}'. Call list_tables to see the real table names.")
  lines = []
  for row in rows:
    column_name = row[0]
    column_type = row[1]
    lines.append(column_name + " " + column_type)
  return "\n".join(lines)

if __name__ == "__main__":
  server.run()