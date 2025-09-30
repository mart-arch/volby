"""Minimal HTTP server exposing the name translation utilities."""

from __future__ import annotations

import json
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterable, MutableMapping, Optional

from .names import NameTranslator


class TranslationHTTPServer(ThreadingHTTPServer):
    """HTTP server that exposes name translation endpoints."""

    translator: NameTranslator

    def __init__(
        self,
        server_address: tuple[str, int],
        RequestHandlerClass: type[BaseHTTPRequestHandler],
        translator: NameTranslator,
    ) -> None:
        super().__init__(server_address, RequestHandlerClass)
        self.translator = translator


class TranslationRequestHandler(BaseHTTPRequestHandler):
    server: TranslationHTTPServer

    def log_message(self, format: str, *args) -> None:  # noqa: A003 - method defined by base class
        """Silence default logging to keep output clean for tests."""

    def do_GET(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path == "/health":
            self._send_json({"status": "ok"})
        else:
            self.send_error(HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:  # noqa: N802 - required by BaseHTTPRequestHandler
        if self.path != "/translate":
            self.send_error(HTTPStatus.NOT_FOUND)
            return

        content_length = int(self.headers.get("Content-Length", "0"))
        try:
            raw_body = self.rfile.read(content_length) if content_length else b""
            payload = json.loads(raw_body.decode("utf-8") or "[]")
        except json.JSONDecodeError:
            self._send_json({"error": "Invalid JSON payload"}, status=HTTPStatus.BAD_REQUEST)
            return

        if not isinstance(payload, list):
            self._send_json(
                {"error": "Expected a JSON array of party results"},
                status=HTTPStatus.BAD_REQUEST,
            )
            return

        results: Iterable[MutableMapping] = payload  # type: ignore[assignment]
        translated = self.server.translator.translate(results)
        self._send_json(translated)

    def _send_json(self, payload: object, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def create_server(
    host: str = "127.0.0.1",
    port: int = 8000,
    *,
    translator: Optional[NameTranslator] = None,
) -> TranslationHTTPServer:
    """Create a translation server ready to serve requests."""

    if translator is None:
        base_path = Path(__file__).resolve().parent
        translator = NameTranslator.from_files(base_path / "cns.xml", base_path / "psrk.xml")

    return TranslationHTTPServer((host, port), TranslationRequestHandler, translator)


def run(host: str = "127.0.0.1", port: int = 8000) -> None:
    """Start serving translation requests until interrupted."""

    server = create_server(host, port)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


__all__ = ["create_server", "run", "TranslationHTTPServer"]


if __name__ == "__main__":
    run()
