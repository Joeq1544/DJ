from __future__ import annotations

import anyio
from mcp import types
from mcp.server.context import ServerRequestContext
from mcp.server.lowlevel import Server
from mcp.server.stdio import stdio_server

from contract import call_echo_library_ids, tool_definition


SERVER_NAME = "dj-copilot-python-mcp-spike"
SERVER_VERSION = "0.0.0"


def build_server(call_delay_seconds: float = 0) -> Server:
    async def list_tools(
        _context: ServerRequestContext,
        _params: types.PaginatedRequestParams | None,
    ) -> types.ListToolsResult:
        return types.ListToolsResult(tools=[tool_definition()])

    async def call_tool(
        _context: ServerRequestContext,
        params: types.CallToolRequestParams,
    ) -> types.CallToolResult:
        if call_delay_seconds > 0:
            await anyio.sleep(call_delay_seconds)
        if params.name != "echo_library_ids":
            return call_echo_library_ids(None)
        return call_echo_library_ids(params.arguments)

    return Server(
        SERVER_NAME,
        version=SERVER_VERSION,
        on_list_tools=list_tools,
        on_call_tool=call_tool,
    )


async def serve(server: Server) -> None:
    async with stdio_server() as (read_stream, write_stream):
        await server.run(
            read_stream,
            write_stream,
            server.create_initialization_options(),
        )


def main() -> None:
    anyio.run(serve, build_server())


if __name__ == "__main__":
    main()
