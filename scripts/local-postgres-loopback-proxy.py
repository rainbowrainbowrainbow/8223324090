import asyncio
import os

LISTEN_HOST = "127.0.0.1"
LISTEN_PORT = int(os.environ.get("EVENTGENIX_LOCAL_PG_PROXY_PORT", "55443"))
POSTGRES_SOCKET = "/var/run/postgresql/.s.PGSQL.5432"


async def pipe(reader, writer):
    try:
        while data := await reader.read(65536):
            writer.write(data)
            await writer.drain()
    finally:
        writer.close()


async def handle(client_reader, client_writer):
    server_reader, server_writer = await asyncio.open_unix_connection(POSTGRES_SOCKET)
    await asyncio.gather(
        pipe(client_reader, server_writer),
        pipe(server_reader, client_writer),
        return_exceptions=True,
    )


async def main():
    server = await asyncio.start_server(handle, LISTEN_HOST, LISTEN_PORT)
    async with server:
        await server.serve_forever()


asyncio.run(main())
