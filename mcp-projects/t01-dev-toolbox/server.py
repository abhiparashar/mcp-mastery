from datetime import datetime
from zoneinfo import ZoneInfo
import uuid
from typing import Annotated
from pydantic import Field
from mcp.server.mcpserver import MCPServer

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

if __name__ == "__main__":
  server.run()