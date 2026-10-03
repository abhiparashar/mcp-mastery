from datetime import datetime
import json
from zoneinfo import ZoneInfo
import uuid
from typing import Annotated
from pydantic import Field
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError

server = MCPServer("dev-toolbox", version="0.1.0")

@server.tool()
def convert_timestamp(timestamp:int, timezone:str) -> str:
  """
  convert a unix timestamp (seconds) to readable date and time
  timezone must be an IANA name, for example "Asia/Kolkata" or "UTC".
  """
  moment = datetime.fromtimestamp(timestamp, tz=ZoneInfo(timezone))
  return moment.strftime("%Y-%m-%d %H:%M:%S %Z")

@server.tool()
def generate_uuid(count: Annotated[int, Field(ge=1, le=100, description="How many UUIDs to make")] = 1)->list[str]:
  """Generate random UUIDs (version 4)."""
  return [str(uuid.uuid4()) for _ in range(count)]

@server.tool()
def format_json(
     text: str,
      indent: Annotated[int, Field(ge=0, le=8, description="Spaces per indent level")] = 2,
)-> str:
  """Pretty-print JSON text. If the JSON is invalid, report the line and column of the error."""
  try:
    data = json.loads(text)
  except json.JSONDecodeError as e:
    raise ToolError(f"Invalid JSON at line {e.lineno}, column {e.colno}: {e.msg}")
  return json.dumps(data, indent=indent, ensure_ascii=False)

if __name__ == "__main__":
  server.run()