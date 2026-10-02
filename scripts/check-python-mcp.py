"""Optional loopback client check. Never reads a live Microsoft credential."""
import asyncio
from importlib.metadata import version
import json
import sys

import httpx2
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client


async def main():
    assert version("mcp") == "2.0.0", "Install the documented Python SDK version in a test venv"
    config = json.loads(sys.stdin.readline())
    # Hermes seeds this handshake version before initialize. Use the same SDK
    # and custom-header path; disable redirects and env proxies for loopback only.
    headers = {"X-MCP-API-Key": config["token"], "MCP-Protocol-Version": "2025-11-25"}
    async with httpx2.AsyncClient(headers=headers, timeout=10, follow_redirects=False, trust_env=False) as client:
        async with streamable_http_client(config["url"], http_client=client) as streams:
            async with ClientSession(streams[0], streams[1], read_timeout_seconds=10) as session:
                initialized = await session.initialize()
                assert initialized.protocol_version == "2025-11-25"
                catalog = await session.list_tools()
                assert len(catalog.tools) == 8
                status = await session.call_tool("todo_connection_status", {})
                assert not status.is_error
                assert status.structured_content["state"] == "not_connected"
                assert status.structured_content["permission"] == "read"
                lists = await session.call_tool("todo_list_lists", {"limit": 1})
                assert lists.is_error
                assert lists.structured_content["error"]["code"] == "not_connected"
                assert "settingsUrl" in lists.structured_content
    print("Python MCP 2.0.0 interoperability passed: handshake, eight tools, personal header, read permission and actionable setup.")


asyncio.run(main())
